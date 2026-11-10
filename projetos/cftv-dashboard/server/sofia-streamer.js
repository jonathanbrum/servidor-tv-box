const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
const ffmpegPath = require('./ffmpeg-path');

function createPacket(msgId, sessionId, payloadObj) {
  const jsonStr = JSON.stringify(payloadObj) + '\n\0';
  const payloadBuf = Buffer.from(jsonStr, 'utf8');
  const header = Buffer.alloc(20);
  header[0] = 0xff; // Sofia magic byte
  header[1] = 0x00;
  header.writeUInt32LE(typeof sessionId === 'string' ? parseInt(sessionId, 16) : (sessionId || 0), 4);
  header.writeUInt16LE(msgId, 14);
  header.writeUInt32LE(payloadBuf.length, 16);
  return Buffer.concat([header, payloadBuf]);
}

/**
 * Gerenciador de Stream H.265 Contínuo via Sofia (porta 34567) + Transcoder FFmpeg -> JSMpeg
 * Implementa desembrulho de pacotes de transporte Sofia (MsgId 1412) de 8KB para alimentar
 * o FFmpeg apenas com NAL units puras H.265 sem injeção de lixo de cabeçalho.
 */
class SofiaStreamer {
  constructor(camConfig) {
    this.cam = camConfig;
    this.clients = new Set();
    this.client = null;
    this.ffmpeg = null;
    this.sessionId = 0;
    this.quality = 'hd';
    this.streamType = 'Main';
    this.isStreaming = false;
    this.tcpBuffer = Buffer.alloc(0);
    this.mediaBuffer = Buffer.alloc(0);
    this.recentTsBuffer = null;
    this.initHeaderChunk = null;
    this.reconnectTimer = null;
    this.fpsCount = 0;
    this.fps = 0;
    this.lastFpsCalc = Date.now();
    this.status = 'offline';
    this.lastError = null;
    this.droppingUntilIFrame = false;

    setInterval(() => {
      const now = Date.now();
      const dt = (now - this.lastFpsCalc) / 1000;
      this.fps = Math.round(this.fpsCount / dt);
      this.fpsCount = 0;
      this.lastFpsCalc = now;
    }, 1000);
  }

  addClient(ws, initialQuality = null) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    this.clients.add(ws);
    console.log(`[SofiaStreamer] Cliente conectado em ${this.cam.name} (${this.cam.id}). Total: ${this.clients.size}`);

    if (initialQuality && initialQuality !== this.quality) {
      this.setQuality(initialQuality);
    } else if (!this.isStreaming || !this.ffmpeg) {
      this.start();
    } else {
      // Se acabou de conectar o primeiro cliente ativo enquanto a câmera já estava aberta:
      if (this.clients.size === 1) {
        console.log(`[SofiaStreamer] ${this.cam.name}: Primeiro cliente ativo reconectado, reiniciando FFmpeg com Sequence Header fresco...`);
        this.droppingUntilIFrame = true;
        this.recentTsBuffer = null;
        this.startFfmpeg();
      } else if (this.recentTsBuffer && this.recentTsBuffer.length > 0 && ws.readyState === ws.OPEN) {
        try { ws.send(this.recentTsBuffer, { binary: true }); } catch (e) {}
      }
    }

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[SofiaStreamer] Cliente desconectado de ${this.cam.name}. Restantes: ${this.clients.size}`);
      if (this.clients.size === 0) {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
          if (this.clients.size === 0) {
            console.log(`[SofiaStreamer] Nenhum cliente ativo em ${this.cam.name}, pausando stream para liberar CPU.`);
            this.stop();
          }
        }, 10000);
      }
    });

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.action === 'setQuality' && data.quality) {
          this.setQuality(data.quality);
        }
      } catch (e) {}
    });
  }

  setQuality(quality) {
    const norm = quality === 'sd' ? 'sd' : 'hd';
    if (this.quality === norm && this.ffmpeg) {
      if (!this.isStreaming && this.clients.size > 0) {
        this.start();
      }
      return;
    }
    this.quality = norm;
    this.streamType = 'Main';
    console.log(`[SofiaStreamer] ${this.cam.name}: Alternando qualidade para ${norm.toUpperCase()}...`);

    // Se a conexão TCP com a câmera já está ativa, não derrube o socket da câmera!
    // Apenas reinicie o processo FFmpeg transcodificador para mudar a escala/bitrate.
    if (this.client && !this.client.destroyed && this.sessionId) {
      this.droppingUntilIFrame = true;
      this.recentTsBuffer = null;
      this.startFfmpeg();
    } else if (this.clients.size > 0) {
      this.start();
    }
  }

  stopFfmpeg() {
    this.initHeaderChunk = null;
    if (this.ffmpeg) {
      const proc = this.ffmpeg;
      this.ffmpeg = null;
      try {
        proc.removeAllListeners('exit');
        if (proc.stdin) {
          proc.stdin.on('error', () => {});
          proc.stdin.destroy();
        }
        proc.kill('SIGTERM');
      } catch (e) {}
    }
  }

  startFfmpeg() {
    this.stopFfmpeg();

    const isHd = this.quality === 'hd';
    const targetScale = isHd ? '1024:576' : '640:360';
    // O padrão MPEG-1 Video (mpeg1video) requer taxa de quadros padronizada (25 fps).
    // Taxas não padronizadas como 15 fps causam falha fatal no encoder do FFmpeg.
    const targetFps = '25';
    console.log(`[SofiaStreamer] FFmpeg ${this.cam.name} (${this.quality.toUpperCase()}): ${targetFps} FPS, ${targetScale}...`);

    const ffmpegArgs = [
      '-loglevel', 'error',
      '-err_detect', 'ignore_err',
      '-fflags', 'nobuffer+flush_packets+genpts',
      '-flags', 'low_delay',
      '-flags2', '+fast',
      '-probesize', '32768',
      '-analyzeduration', '0',
      '-f', 'hevc',
      '-i', 'pipe:0',
      '-vf', `scale=${targetScale}:flags=fast_bilinear`,
      '-f', 'mpegts',
      '-mpegts_flags', '+resend_headers',
      '-codec:v', 'mpeg1video',
      '-q:v', isHd ? '4' : '7',
      '-r', targetFps,
      '-g', targetFps,
      '-bf', '0',
      '-threads', '1',
      '-flush_packets', '1',
      '-an'
    ];

    if (!isHd) {
      ffmpegArgs.push('-b:v', '450k');
    }

    ffmpegArgs.push('pipe:1');

    this.ffmpeg = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true });

    if (this.ffmpeg.stdin) {
      this.ffmpeg.stdin.on('error', () => {});
    }

    let firstMpegFrame = false;

    this.ffmpeg.stdout.on('data', (chunk) => {
      this.fpsCount++;
      this.status = 'online';

      if (!firstMpegFrame) {
        firstMpegFrame = true;
        this.initHeaderChunk = chunk.slice(0, Math.min(chunk.length, 3760));
        console.log(`[SofiaStreamer] ${this.cam.name} (${this.quality.toUpperCase()}): Primeiro pacote MPEG-TS entregue com sucesso!`);
      }

      if (!this.recentTsBuffer) {
        this.recentTsBuffer = chunk;
      } else {
        this.recentTsBuffer = Buffer.concat([this.recentTsBuffer, chunk]);
        const maxLen = 37600; // ~200 pacotes TS (tempo real imediato)
        if (this.recentTsBuffer.length > maxLen) {
          const excess = this.recentTsBuffer.length - maxLen;
          const alignedCut = Math.ceil(excess / 188) * 188;
          this.recentTsBuffer = this.recentTsBuffer.slice(alignedCut);
        }
      }

      for (const ws of this.clients) {
        if (ws.readyState === ws.OPEN) {
          if (ws.bufferedAmount > 512 * 1024) {
            continue;
          }
          try {
            ws.send(chunk, { binary: true });
          } catch (e) {}
        }
      }
    });

    this.ffmpeg.stderr.on('data', (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.warn(`[FFmpeg ${this.cam.name}]:`, msg);
    });

    this.ffmpeg.on('error', (err) => {
      console.warn(`[SofiaStreamer] Erro FFmpeg (${this.cam.name}):`, err.message);
    });

    this.ffmpeg.on('exit', (code, signal) => {
      if (signal !== 'SIGTERM' && signal !== 'SIGKILL' && this.isStreaming && this.clients.size > 0) {
        this.scheduleReconnect('FFmpeg finalizou inesperadamente');
      }
    });
  }

  start() {
    this.stop();
    this.isStreaming = true;
    this.status = 'connecting';
    this.droppingUntilIFrame = false;
    this.tcpBuffer = Buffer.alloc(0);
    this.mediaBuffer = Buffer.alloc(0);
    this.recentTsBuffer = null;

    this.startFfmpeg();

    this.client = new net.Socket();
    this.client.setTimeout(8000);

    this.client.connect(this.cam.port || 34567, this.cam.host, () => {
      const loginPkt = createPacket(1000, 0, {
        EncryptType: 'NONE',
        LoginType: 'DVRIP-Web',
        PassWord: this.cam.pass || '',
        UserName: this.cam.user || 'admin'
      });
      this.client.write(loginPkt);
    });

    let step = 'login';

    this.client.on('data', (buf) => {
      if (step === 'login') {
        if (buf.length >= 20) {
          try {
            const data = JSON.parse(buf.slice(20).toString('utf8').replace(/\0/g, '').trim());
            this.sessionId = data.SessionID;
            step = 'claim';

            const claimPkt = createPacket(1413, this.sessionId, {
              Name: 'OPMonitor',
              SessionID: this.sessionId,
              OPMonitor: {
                Action: 'Claim',
                Parameter: {
                  Channel: 0,
                  CombinMode: 'NONE',
                  StreamType: this.streamType,
                  TransMode: 'TCP'
                }
              }
            });
            this.client.write(claimPkt);
          } catch (e) {
            console.warn(`[SofiaStreamer] Erro login (${this.cam.name}):`, e.message);
          }
        }
      } else if (step === 'claim') {
        step = 'streaming';
        const startPkt = createPacket(1410, this.sessionId, {
          Name: 'OPMonitor',
          SessionID: this.sessionId,
          OPMonitor: {
            Action: 'Start',
            Parameter: {
              Channel: 0,
              CombinMode: 'NONE',
              StreamType: this.streamType,
              TransMode: 'TCP'
            }
          }
        });
        this.client.write(startPkt);
      } else if (step === 'streaming') {
        this.tcpBuffer = Buffer.concat([this.tcpBuffer, buf]);
        this.processSofiaPackets();
      }
    });

    this.client.on('timeout', () => {
      this.client.destroy();
      this.scheduleReconnect('Timeout de resposta da câmera');
    });

    this.client.on('error', (err) => {
      this.lastError = err.message;
      this.scheduleReconnect(`Erro TCP: ${err.message}`);
    });

    this.client.on('close', () => {
      if (this.isStreaming && this.clients.size > 0) {
        this.scheduleReconnect('Conexão com a câmera fechada');
      }
    });
  }

  processSofiaPackets() {
    while (this.tcpBuffer.length >= 20) {
      const idx = this.tcpBuffer.indexOf(Buffer.from([0xff, 0x01]));
      if (idx === -1) {
        this.tcpBuffer = Buffer.alloc(0);
        break;
      }
      if (idx > 0) {
        this.tcpBuffer = this.tcpBuffer.slice(idx);
      }
      if (this.tcpBuffer.length < 20) break;

      const msgId = this.tcpBuffer.readUInt16LE(14);
      const dataLen = this.tcpBuffer.readUInt32LE(16);
      const totalPktLen = 20 + dataLen;

      if (this.tcpBuffer.length < totalPktLen) {
        // Aguarda pacote Sofia completo
        break;
      }

      const payload = this.tcpBuffer.slice(20, totalPktLen);
      this.tcpBuffer = this.tcpBuffer.slice(totalPktLen);

      if (msgId === 1412) {
        // Canal de mídia: anexa ao mediaBuffer e decodifica quadros
        this.mediaBuffer = Buffer.concat([this.mediaBuffer, payload]);
        this.processMediaFrames();
      }
    }
  }

  processMediaFrames() {
    while (this.mediaBuffer.length >= 16) {
      const idx = this.mediaBuffer.indexOf(Buffer.from([0, 0, 1]));
      if (idx === -1) {
        if (this.mediaBuffer.length > 200000) {
          this.mediaBuffer = Buffer.alloc(0);
        }
        break;
      }
      if (idx > 0) {
        this.mediaBuffer = this.mediaBuffer.slice(idx);
      }
      if (this.mediaBuffer.length < 16) break;

      const pType = this.mediaBuffer[3];
      let size = 0;
      let payloadOffset = 0;

      if (pType === 0xFC || pType === 0xFE) {
        // I-Frame (contém SPS, PPS, VPS e fatia IDR pura)
        size = this.mediaBuffer.readUInt32LE(12) + 16;
        payloadOffset = 16;
      } else if (pType === 0xFD) {
        // P-Frame (fatia delta pura)
        size = this.mediaBuffer.readUInt32LE(4) + 8;
        payloadOffset = 8;
      } else if (pType === 0xFA || pType === 0xF9) {
        // Áudio
        size = this.mediaBuffer.readUInt16LE(6) + 8;
        payloadOffset = 8;
      } else {
        this.mediaBuffer = this.mediaBuffer.slice(1);
        continue;
      }

      if (this.mediaBuffer.length < size) {
        // Aguarda quadro completo ser montado pelos pacotes Sofia
        break;
      }

      const frameData = this.mediaBuffer.slice(payloadOffset, size);
      this.mediaBuffer = this.mediaBuffer.slice(size);

      if (pType === 0xFC || pType === 0xFE || pType === 0xFD) {
        if (this.ffmpeg && this.ffmpeg.stdin && !this.ffmpeg.stdin.destroyed) {
          const isIFrame = (pType === 0xFC || pType === 0xFE);
          const queueSize = this.ffmpeg.stdin.writableLength || 0;

          // Se a fila passar de 160KB (~1.2s), ativa descarte atômico até o próximo I-Frame
          if (queueSize > 160000) {
            this.droppingUntilIFrame = true;
          }

          // Se estiver em modo de descarte, aguarda até o próximo I-Frame limpo com fila drenada
          if (this.droppingUntilIFrame) {
            if (isIFrame && queueSize < 65536) {
              this.droppingUntilIFrame = false;
            } else {
              continue;
            }
          }

          try {
            this.ffmpeg.stdin.write(frameData);
          } catch (e) {}
        }
      }
    }
  }

  scheduleReconnect(reason = '') {
    this.status = 'reconnecting';
    this.stop();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.clients.size > 0) {
        console.log(`[SofiaStreamer] Reconectando ${this.cam.name} (${reason})...`);
        this.start();
      }
    }, 2500);
  }

  stop() {
    this.isStreaming = false;
    this.droppingUntilIFrame = false;
    this.recentTsBuffer = null;
    this.tcpBuffer = Buffer.alloc(0);
    this.mediaBuffer = Buffer.alloc(0);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      const socket = this.client;
      this.client = null;
      // Garante que erros de write EOF / EPIPE durante o fechamento sejam silenciados
      socket.on('error', () => {});

      try {
        if (this.sessionId && !socket.destroyed && socket.writable) {
          socket.write(createPacket(1410, this.sessionId, {
            Name: 'OPMonitor',
            SessionID: this.sessionId,
            OPMonitor: { Action: 'Stop', Parameter: { Channel: 0 } }
          }));
          socket.write(createPacket(1002, this.sessionId, {
            Name: 'Logout',
            SessionID: this.sessionId
          }));
        }
      } catch (e) {}

      try {
        socket.destroy();
      } catch (e) {}
    }

    this.sessionId = 0;
    this.stopFfmpeg();
  }
}

module.exports = SofiaStreamer;
