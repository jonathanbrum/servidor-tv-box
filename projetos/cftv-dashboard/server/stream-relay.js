const net = require('net');
const config = require('./config');
const XMeyeClient = require('./xmeye-client');

const SofiaStreamer = require('./sofia-streamer');

/**
 * Gerenciador unificado de streaming: Suporta RTSP (554 via JSMpeg) e nativo XMeye (34567 via WebSockets).
 */
class StreamRelayManager {
  constructor(app, server) {
    this.app = app;
    this.server = server;
    this.rtspRelay = require('rtsp-relay')(app, server);

    this.sofiaStreamers = {
      cam1: new SofiaStreamer(config.cameras.cam1),
      cam2: new SofiaStreamer(config.cameras.cam2)
    };

    this.cameraState = {
      cam1: {
        ...config.cameras.cam1,
        tcpReachable: false,
        latencyMs: null,
        lastCheck: null,
        clientsCount: 0,
        status: 'initializing',
        lastError: null,
        lastFrame: null,
        lastFrameTime: 0
      },
      cam2: {
        ...config.cameras.cam2,
        tcpReachable: false,
        latencyMs: null,
        lastCheck: null,
        clientsCount: 0,
        status: 'initializing',
        lastError: null,
        lastFrame: null,
        lastFrameTime: 0
      }
    };

    // Loops de captura ativa para câmeras nativas na porta 34567
    this.activeCaptureLoops = new Map();

    // Verificação de conectividade periódica
    this.startHealthChecks();
  }

  /**
   * Testa conectividade TCP direta na porta do dispositivo.
   */
  async checkTcpReachability(host, port, timeout = 2500) {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(timeout);

      socket.on('connect', () => {
        const latencyMs = Date.now() - start;
        socket.destroy();
        resolve({ reachable: true, latencyMs, error: null });
      });

      socket.on('error', (err) => {
        resolve({ reachable: false, latencyMs: null, error: err.message });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ reachable: false, latencyMs: null, error: 'Tempo limite esgotado (Timeout)' });
      });

      socket.connect(port, host);
    });
  }

  async runHealthCheck(camId) {
    const cam = this.cameraState[camId];
    if (!cam) return;

    try {
      let result = await this.checkTcpReachability(cam.host, cam.port);
      if (!result.reachable && cam.port !== 34567) {
        const alt = await this.checkTcpReachability(cam.host, 34567);
        if (alt.reachable) {
          result = alt;
          cam.port = 34567;
        }
      }

      cam.tcpReachable = result.reachable;
      cam.latencyMs = result.latencyMs;
      cam.lastCheck = new Date().toISOString();
      cam.lastError = result.error;

      if (result.reachable) {
        cam.status = 'online';
      } else {
        cam.status = cam.clientsCount > 0 ? 'reconnecting' : 'offline';
      }
    } catch (err) {
      cam.tcpReachable = false;
      cam.status = 'offline';
      cam.lastError = err.message;
    }
  }

  startHealthChecks() {
    const checkAll = async () => {
      await Promise.all([
        this.runHealthCheck('cam1'),
        this.runHealthCheck('cam2')
      ]);
    };
    checkAll();
    this.healthInterval = setInterval(checkAll, 8000);
  }

  /**
   * Dispara um loop contínuo de captura para enviar quadros a clientes WebSocket conectados
   */
  startXMeyeStreamLoop(camId, ws, req) {
    const cam = this.cameraState[camId];
    if (!cam) return;

    let isAlive = true;
    let frameDelayMs = (req && req.query && req.query.quality === 'sd') ? 1200 : 20;

    ws.on('close', () => { isAlive = false; });
    ws.on('error', () => { isAlive = false; });

    // Permite ao frontend alternar a qualidade dinamicamente sem reconectar
    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.action === 'setQuality') {
          frameDelayMs = data.quality === 'sd' ? 1200 : 20;
          console.log(`[StreamRelay] ${cam.name} (${camId}) qualidade alterada para: ${data.quality.toUpperCase()} (${frameDelayMs}ms)`);
        }
      } catch (e) {}
    });

    const fetchNext = async () => {
      if (!isAlive || ws.readyState !== ws.OPEN) return;

      try {
        const snap = await XMeyeClient.getSnapshot({
          host: cam.host,
          port: cam.port || 34567,
          user: cam.user,
          pass: cam.pass
        }, 1500);

        if (snap && isAlive && ws.readyState === ws.OPEN) {
          cam.lastFrame = snap;
          cam.lastFrameTime = Date.now();
          cam.status = 'online';
          ws.send(snap, { binary: true });
        }
      } catch (err) {
        // Ignora pequenas falhas de frame transitórias
      }

      // Agenda o próximo quadro de acordo com a qualidade escolhida
      if (isAlive && ws.readyState === ws.OPEN) {
        setTimeout(fetchNext, frameDelayMs);
      }
    };

    // Se já tivermos um último quadro em cache, envia imediatamente para pintar a tela sem delay
    if (cam.lastFrame && ws.readyState === ws.OPEN) {
      ws.send(cam.lastFrame, { binary: true });
    }

    fetchNext();
  }

  /**
   * Middleware WebSocket para cada câmera
   */
  createStreamHandler(camId) {
    return (ws, req) => {
      const camConfig = config.cameras[camId];
      if (!camConfig) {
        ws.close(1008, 'Câmera não encontrada');
        return;
      }

      const cam = this.cameraState[camId];
      cam.clientsCount += 1;
      cam.status = 'online';
      console.log(`[StreamRelay] Cliente WebSocket conectado em ${camConfig.name} (${camId})`);

      ws.on('close', () => {
        cam.clientsCount = Math.max(0, cam.clientsCount - 1);
        console.log(`[StreamRelay] Cliente desconectado de ${camConfig.name} (${camId}). Restantes: ${cam.clientsCount}`);
      });

      // Se a porta for 34567 (Xiongmai Sofia), usa o streamer contínuo H.265 -> JSMpeg
      if (cam.port === 34567) {
        const quality = (req.query && req.query.quality) || 'hd';
        const streamer = this.sofiaStreamers[camId];
        if (streamer) {
          streamer.addClient(ws, quality);
        } else {
          this.startXMeyeStreamLoop(camId, ws, req);
        }
      } else {
        // Se for 554, usa o rtsp-relay padrão
        const subtype = req.query.subtype !== undefined ? parseInt(req.query.subtype, 10) : 0;
        const rtspUrl = config.buildRtspUrl(camConfig, { subtype });
        try {
          const proxy = this.rtspRelay.proxy({
            url: rtspUrl,
            transport: 'tcp',
            additionalFlags: ['-q', '3', '-b:v', '2000k', '-an']
          });
          proxy(ws, req);
        } catch (err) {
          console.warn(`[StreamRelay] Falha no proxy RTSP para ${camId}, alternando para Sofia loop:`, err.message);
          this.startXMeyeStreamLoop(camId, ws);
        }
      }
    };
  }

  getStatus() {
    const now = new Date();
    return {
      status: 'ok',
      timestamp: now.toISOString(),
      serverUptime: Math.floor(process.uptime()),
      cameras: {
        cam1: {
          id: 'cam1',
          name: this.cameraState.cam1.name,
          host: this.cameraState.cam1.host,
          port: this.cameraState.cam1.port,
          description: this.cameraState.cam1.description,
          rtspUrlMasked: config.sanitizeRtspUrl(config.buildRtspUrl(this.cameraState.cam1)),
          tcpReachable: this.cameraState.cam1.tcpReachable,
          latencyMs: this.cameraState.cam1.latencyMs,
          status: this.cameraState.cam1.status,
          clientsCount: this.cameraState.cam1.clientsCount,
          stdinQueueBytes: (this.sofiaStreamers.cam1 && this.sofiaStreamers.cam1.ffmpeg && this.sofiaStreamers.cam1.ffmpeg.stdin) ? this.sofiaStreamers.cam1.ffmpeg.stdin.writableLength : 0,
          mediaBufferBytes: (this.sofiaStreamers.cam1) ? this.sofiaStreamers.cam1.mediaBuffer.length : 0,
          lastCheck: this.cameraState.cam1.lastCheck,
          lastError: this.cameraState.cam1.lastError,
          streamEndpoint: '/api/stream/cam1'
        },
        cam2: {
          id: 'cam2',
          name: this.cameraState.cam2.name,
          host: this.cameraState.cam2.host,
          port: this.cameraState.cam2.port,
          description: this.cameraState.cam2.description,
          rtspUrlMasked: config.sanitizeRtspUrl(config.buildRtspUrl(this.cameraState.cam2)),
          tcpReachable: this.cameraState.cam2.tcpReachable,
          latencyMs: this.cameraState.cam2.latencyMs,
          status: this.cameraState.cam2.status,
          clientsCount: this.cameraState.cam2.clientsCount,
          stdinQueueBytes: (this.sofiaStreamers.cam2 && this.sofiaStreamers.cam2.ffmpeg && this.sofiaStreamers.cam2.ffmpeg.stdin) ? this.sofiaStreamers.cam2.ffmpeg.stdin.writableLength : 0,
          mediaBufferBytes: (this.sofiaStreamers.cam2) ? this.sofiaStreamers.cam2.mediaBuffer.length : 0,
          lastCheck: this.cameraState.cam2.lastCheck,
          lastError: this.cameraState.cam2.lastError,
          streamEndpoint: '/api/stream/cam2',
          tip: 'Se offline, ative Port Forwarding da porta 34567 no Roteador 2 apontando para 192.168.2.100'
        }
      }
    };
  }
}

module.exports = StreamRelayManager;
