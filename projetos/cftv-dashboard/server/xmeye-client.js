const net = require('net');

/**
 * Cliente nativo para câmeras XMeye / Xiongmai usando o protocolo Sofia / DVR-IP (porta 34567).
 * Permite autenticação, consulta de estado e captura de snapshots instantâneos (OPSNAP)
 * sem depender de RTSP ou portas bloqueadas.
 */
class XMeyeClient {
  /**
   * Constrói o cabeçalho binário padrão do protocolo Sofia (20 bytes).
   */
  static createPacket(msgId, sessionId = 0, payloadObj = {}) {
    const payload = JSON.stringify(payloadObj) + '\n\0';
    const payloadBuf = Buffer.from(payload, 'utf8');
    const header = Buffer.alloc(20);
    header[0] = 0xff; // Sofia magic byte
    header[1] = 0x00; // version
    header.writeUInt32LE(typeof sessionId === 'string' ? parseInt(sessionId, 16) : (sessionId || 0), 4);
    header.writeUInt16LE(msgId, 14);
    header.writeUInt32LE(payloadBuf.length, 16);
    return Buffer.concat([header, payloadBuf]);
  }

  /**
   * Captura um snapshot instantâneo em alta definição diretamente do sensor da câmera via porta 34567.
   * @param {Object} camConfig Objeto com host, port, user e pass da câmera
   * @param {number} [timeoutMs=4000] Tempo limite para resposta
   * @returns {Promise<Buffer>} Buffer contendo a imagem JPEG completa
   */
  static async getSnapshot(camConfig, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      const chunks = [];
      let sessionId = 0;
      let isCapturing = false;
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        client.destroy();
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Tempo limite esgotado ao capturar foto de ${camConfig.host}:34567`));
      }, timeoutMs);

      client.connect(camConfig.port || 34567, camConfig.host, () => {
        // Envia pacote de Login (MsgId 1000)
        const loginPkt = XMeyeClient.createPacket(1000, 0, {
          EncryptType: 'NONE',
          LoginType: 'DVRIP-Web',
          PassWord: camConfig.pass || '',
          UserName: camConfig.user || 'admin'
        });
        client.write(loginPkt);
      });

      client.on('data', (buf) => {
        if (!isCapturing) {
          if (buf.length >= 20) {
            const msgId = buf.readUInt16LE(14);
            // Resposta de Login (MsgId 1001)
            if (msgId === 1001) {
              try {
                const jsonStr = buf.slice(20).toString('utf8').replace(/\0/g, '').trim();
                const data = JSON.parse(jsonStr);
                if (data.Ret === 100) {
                  sessionId = data.SessionID;
                  isCapturing = true;
                  // Envia comando OPSNAP (MsgId 1560)
                  const snapPkt = XMeyeClient.createPacket(1560, sessionId, {
                    Name: 'OPSNAP',
                    OPSNAP: { Channel: 0 }
                  });
                  client.write(snapPkt);
                } else {
                  cleanup();
                  reject(new Error(`Falha no login XMeye (código ${data.Ret}). Verifique a senha.`));
                }
              } catch (e) {
                cleanup();
                reject(new Error(`Erro ao interpretar resposta de login: ${e.message}`));
              }
            }
          }
        } else {
          chunks.push(buf);
          const currentTotal = Buffer.concat(chunks);
          // Verifica se os marcadores SOI (0xFFD8) e EOI (0xFFD9) de JPEG estão presentes
          const start = currentTotal.indexOf(Buffer.from([0xff, 0xd8]));
          const end = currentTotal.lastIndexOf(Buffer.from([0xff, 0xd9]));
          if (start !== -1 && end !== -1 && end > start) {
            cleanup();
            const jpegBuffer = currentTotal.slice(start, end + 2);
            resolve(jpegBuffer);
          }
        }
      });

      client.on('error', (err) => {
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Testa a conectividade e autenticação com uma câmera XMeye na porta 34567.
   */
  static async testConnection(host, port = 34567, user = 'admin', pass = '', timeoutMs = 2000) {
    return new Promise((resolve) => {
      const client = new net.Socket();
      const start = Date.now();
      let timer = null;

      const finish = (result) => {
        if (timer) clearTimeout(timer);
        client.destroy();
        resolve(result);
      };

      timer = setTimeout(() => {
        finish({ ok: false, error: 'Timeout de conexão' });
      }, timeoutMs);

      client.connect(port, host, () => {
        const loginPkt = XMeyeClient.createPacket(1000, 0, {
          EncryptType: 'NONE',
          LoginType: 'DVRIP-Web',
          PassWord: pass,
          UserName: user
        });
        client.write(loginPkt);
      });

      client.on('data', (buf) => {
        if (buf.length >= 20 && buf.readUInt16LE(14) === 1001) {
          try {
            const jsonStr = buf.slice(20).toString('utf8').replace(/\0/g, '').trim();
            const data = JSON.parse(jsonStr);
            const latencyMs = Date.now() - start;
            if (data.Ret === 100) {
              finish({ ok: true, latencyMs, sessionId: data.SessionID, deviceType: data['DeviceType '] || 'IPC' });
            } else {
              finish({ ok: false, latencyMs, error: `Login rejeitado (Ret: ${data.Ret})` });
            }
          } catch (e) {
            finish({ ok: false, error: e.message });
          }
        }
      });

      client.on('error', (err) => {
        finish({ ok: false, error: err.message });
      });
    });
  }
}

module.exports = XMeyeClient;
