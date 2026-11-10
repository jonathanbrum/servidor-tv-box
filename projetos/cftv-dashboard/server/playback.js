const net = require('net');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const config = require('./config');
const XMeye = require('./xmeye-client');
const ffmpegPath = require('./ffmpeg-path');
const cacheDir = path.resolve(__dirname, '../scratch/cache');

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// Mapa para evitar downloads simultâneos do mesmo arquivo
const inFlightRequests = new Map();

class PlaybackManager {
  /**
   * Consulta a lista de gravações salvas no equipamento para uma determinada data.
   * @param {string} camId 'cam1' ou 'cam2'
   * @param {string} dateStr 'AAAA-MM-DD' (ex: '2026-10-28')
   */
  static async listRecordings(camId, dateStr) {
    const cam = config.cameras[camId];
    if (!cam) throw new Error(`Câmera ${camId} não encontrada`);

    const date = dateStr || new Date().toISOString().slice(0, 10);
    const beginTime = `${date} 00:00:00`;
    const endTime = `${date} 23:59:59`;

    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      client.setTimeout(6000);

      let sessionId = 0;
      let step = 'login';
      let incoming = Buffer.alloc(0);

      const cleanup = () => {
        client.destroy();
      };

      client.connect(cam.port || 34567, cam.host, () => {
        const loginPkt = XMeye.createPacket(1000, 0, {
          EncryptType: 'NONE',
          LoginType: 'DVRIP-Web',
          PassWord: cam.pass || '',
          UserName: cam.user || 'admin'
        });
        client.write(loginPkt);
      });

      client.on('data', (buf) => {
        incoming = Buffer.concat([incoming, buf]);

        while (incoming.length >= 20) {
          const idx = incoming.indexOf(0xff);
          if (idx === -1) { incoming = Buffer.alloc(0); break; }
          if (idx > 0) { incoming = incoming.slice(idx); }
          if (incoming.length < 20) break;

          const msgId = incoming.readUInt16LE(14);
          const dataLen = incoming.readUInt32LE(16);
          if (incoming.length < 20 + dataLen) break;

          const payload = incoming.slice(20, 20 + dataLen);
          incoming = incoming.slice(20 + dataLen);

          if (step === 'login') {
            try {
              const data = JSON.parse(payload.toString('utf8').replace(/\0/g, '').trim());
              sessionId = data.SessionID;
              step = 'query';

              const queryPkt = XMeye.createPacket(1440, sessionId, {
                Name: 'OPFileQuery',
                SessionID: sessionId,
                OPFileQuery: {
                  BeginTime: beginTime,
                  EndTime: endTime,
                  Channel: 0,
                  Event: '*',
                  Type: 'all'
                }
              });
              client.write(queryPkt);
            } catch (e) {
              cleanup();
              return reject(new Error('Falha no login: ' + e.message));
            }
          } else if (step === 'query') {
            cleanup();
            try {
              const jsonStr = payload.toString('utf8').replace(/\0/g, '').trim();
              const data = JSON.parse(jsonStr);
              const files = (data && data.OPFileQuery) || [];

              const formatted = files.map((f, i) => {
                const bTime = new Date(f.BeginTime.replace(/-/g, '/'));
                const eTime = new Date(f.EndTime.replace(/-/g, '/'));
                const duration = Math.max(1, Math.round((eTime - bTime) / 1000));
                const isMotion = (f.FileName && f.FileName.includes('[M]'));

                return {
                  id: i,
                  fileName: f.FileName,
                  startTime: f.BeginTime,
                  endTime: f.EndTime,
                  durationSeconds: duration,
                  type: isMotion ? 'motion' : 'regular',
                  typeLabel: isMotion ? 'Movimento' : 'Contínuo',
                  fileLength: f.FileLength
                };
              });

              // Ordena do mais recente para o mais antigo
              formatted.sort((a, b) => new Date(b.startTime.replace(/-/g, '/')) - new Date(a.startTime.replace(/-/g, '/')));

              return resolve({
                success: true,
                camId,
                name: cam.name,
                date,
                total: formatted.length,
                recordings: formatted
              });
            } catch (e) {
              return reject(new Error('Erro ao interpretar lista de gravações: ' + e.message));
            }
          }
        }
      });

      client.on('timeout', () => {
        cleanup();
        reject(new Error('Timeout de comunicação com a câmera'));
      });

      client.on('error', (err) => {
        cleanup();
        reject(new Error('Erro de conexão: ' + err.message));
      });
    });
  }

  /**
   * Baixa uma gravação específica da câmera e converte para MP4 sob demanda.
   * Mantém em cache temporário volátil (apagando gravações antigas para não ocupar disco).
   */
  static async fetchClipAsMp4(camId, fileName, startTime, endTime) {
    const cam = config.cameras[camId];
    if (!cam) throw new Error(`Câmera ${camId} não encontrada`);

    const fileHash = crypto.createHash('md5').update(`${camId}_${fileName}`).digest('hex').slice(0, 12);
    const mp4Path = path.resolve(cacheDir, `clip_${fileHash}.mp4`);
    const rawPath = path.resolve(cacheDir, `raw_${fileHash}.bin`);

    // 1. Se já estiver no cache, devolve na hora!
    if (fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 10000) {
      return mp4Path;
    }

    // Se já estiver baixando este mesmo arquivo em paralelo, aguarda a promessa existente
    if (inFlightRequests.has(fileHash)) {
      return inFlightRequests.get(fileHash);
    }

    const task = (async () => {
      try {
        // Remove arquivos residuais se existirem
        if (fs.existsSync(rawPath)) {
          try { fs.unlinkSync(rawPath); } catch (e) {}
        }

        // 2. Conecta na câmera e faz o download
        await new Promise((resolve, reject) => {
          const client = new net.Socket();
          client.setTimeout(12000);

          let sessionId = 0;
          let step = 'login';
          let incoming = Buffer.alloc(0);
          const mediaChunks = [];
          let totalBytes = 0;
          let endTimer = null;

          const finishAndConvert = () => {
            if (endTimer) clearTimeout(endTimer);
            client.destroy();
            if (totalBytes > 0) {
              fs.writeFileSync(rawPath, Buffer.concat(mediaChunks));
              resolve(true);
            } else {
              reject(new Error('Nenhum dado de vídeo foi recebido da câmera.'));
            }
          };

          client.connect(cam.port || 34567, cam.host, () => {
            client.write(XMeye.createPacket(1000, 0, {
              EncryptType: 'NONE',
              LoginType: 'DVRIP-Web',
              PassWord: cam.pass || '',
              UserName: cam.user || 'admin'
            }));
          });

          client.on('data', (buf) => {
            incoming = Buffer.concat([incoming, buf]);

            while (incoming.length >= 20) {
              const idx = incoming.indexOf(0xff);
              if (idx === -1) { incoming = Buffer.alloc(0); break; }
              if (idx > 0) { incoming = incoming.slice(idx); }
              if (incoming.length < 20) break;

              const msgId = incoming.readUInt16LE(14);
              const dataLen = incoming.readUInt32LE(16);
              if (incoming.length < 20 + dataLen) break;

              const payload = incoming.slice(20, 20 + dataLen);
              incoming = incoming.slice(20 + dataLen);

              if (step === 'login') {
                const data = JSON.parse(payload.toString('utf8').replace(/\0/g, '').trim());
                sessionId = data.SessionID;
                step = 'claim';

                const claimPkt = {
                  Name: 'OPPlayBack',
                  SessionID: sessionId,
                  OPPlayBack: {
                    Action: 'Claim',
                    Parameter: {
                      PlayMode: 'ByName',
                      FileName: fileName,
                      StreamType: 0,
                      Value: 0,
                      TransMode: 'TCP'
                    }
                  }
                };
                client.write(XMeye.createPacket(1424, sessionId, claimPkt));
              } else if (step === 'claim') {
                step = 'download';

                const dlPkt = {
                  Name: 'OPPlayBack',
                  SessionID: sessionId,
                  OPPlayBack: {
                    Action: 'DownloadStart',
                    Parameter: {
                      PlayMode: 'ByName',
                      FileName: fileName,
                      StreamType: 0,
                      Value: 0,
                      TransMode: 'TCP'
                    },
                    StartTime: startTime,
                    EndTime: endTime
                  }
                };
                client.write(XMeye.createPacket(1420, sessionId, dlPkt));

                endTimer = setTimeout(() => {
                  finishAndConvert();
                }, 8000);
              } else if (step === 'download') {
                if (msgId === 1426 || msgId === 1424 || msgId === 1420 || msgId === 1412) {
                  if (payload[0] !== 0x7b) {
                    mediaChunks.push(payload);
                    totalBytes += payload.length;

                    if (endTimer) clearTimeout(endTimer);
                    endTimer = setTimeout(() => {
                      finishAndConvert();
                    }, 1500);
                  } else {
                    const text = payload.toString().replace(/\0/g, '').trim();
                    if (text.includes('DownloadEnd') || text.includes('DownloadStop')) {
                      finishAndConvert();
                    }
                  }
                }
              }
            }
          });

          client.on('timeout', () => { finishAndConvert(); });
          client.on('error', (err) => { client.destroy(); reject(err); });
        });

        // 3. Converte o fluxo bruto HEVC para MP4 universal com FFmpeg e FastStart
        try {
          cp.execFileSync(ffmpegPath, [
            '-y',
            '-f', 'hevc',
            '-i', rawPath,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '24',
            '-movflags', '+faststart',
            mp4Path
          ]);
          if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
        } catch (err) {
          if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
          throw new Error('Falha ao converter gravação para MP4: ' + err.message);
        }

        // 4. Limpeza automática do cache: mantém no máximo 4 arquivos no cache temporário
        this.cleanCache(4);

        return mp4Path;
      } finally {
        inFlightRequests.delete(fileHash);
      }
    })();

    inFlightRequests.set(fileHash, task);
    return task;
  }

  /**
   * Mantém o diretório de cache leve, removendo gravações antigas se ultrapassar o limite.
   */
  static cleanCache(maxFiles = 4) {
    try {
      const files = fs.readdirSync(cacheDir)
        .filter(f => f.endsWith('.mp4'))
        .map(f => {
          const fullPath = path.join(cacheDir, f);
          return { name: f, path: fullPath, time: fs.statSync(fullPath).mtimeMs };
        });

      if (files.length > maxFiles) {
        files.sort((a, b) => a.time - b.time);
        const toDelete = files.slice(0, files.length - maxFiles);
        toDelete.forEach(f => {
          try { fs.unlinkSync(f.path); } catch (e) {}
        });
      }
    } catch (e) {}
  }
}

module.exports = PlaybackManager;
