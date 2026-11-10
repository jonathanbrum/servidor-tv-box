const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('./ffmpeg-path');
const config = require('./config');
const StreamRelayManager = require('./stream-relay');
const tuyaService = require('./tuya');

// Tratamento global de erros de rede para evitar que desconexões abruptas derrubem o servidor
process.on('uncaughtException', (err) => {
  if (['EOF', 'EPIPE', 'ECONNRESET', 'ETIMEDOUT'].includes(err.code) || err.syscall === 'write') {
    return;
  }
  console.error('[Server UncaughtException]', err);
});

/**
 * Retorna os endereços IPv4 da máquina na rede local (Wi-Fi / Ethernet)
 */
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        addresses.push({ name, ip: net.address });
      }
    }
  }
  return addresses;
}

const app = express();
const server = http.createServer(app);

// Inicializa o gerenciador de streams RTSP e WebSocket
const streamRelay = new StreamRelayManager(app, server);

// Middlewares para JSON e arquivos estáticos da pasta public/
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

/**
 * PERSISTÊNCIA DAS CONFIGURAÇÕES DO VIGIA IA
 * Salva no arquivo server/ai-settings.json para manter sincronizado com TVs, celulares e reinicializações
 */
const AI_SETTINGS_FILE = path.join(__dirname, 'ai-settings.json');

const DEFAULT_AI_SETTINGS = {
  masterVigia: true,
  camId: 'cam2',
  sourceType: 'live-cam',
  sourceTitle: 'CAM 2 (Entrada - Ao Vivo)',
  roi: { x: 0.15, y: 0.20, w: 0.70, h: 0.65 },
  durationSeconds: 5.0,
  confidence: 55,
  enabledClasses: ['person', 'car', 'motorcycle'],
  soundAlert: true,
  windowsNotify: true,
  webhookUrl: ''
};

function getAiSettings() {
  try {
    if (fs.existsSync(AI_SETTINGS_FILE)) {
      const data = fs.readFileSync(AI_SETTINGS_FILE, 'utf8');
      return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.warn('[AI Settings] Erro ao ler ai-settings.json:', err.message);
  }
  return { ...DEFAULT_AI_SETTINGS };
}

function saveAiSettings(newSettings) {
  try {
    const current = getAiSettings();
    const updated = { ...current, ...newSettings };
    fs.writeFileSync(AI_SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (err) {
    console.error('[AI Settings] Erro ao salvar ai-settings.json:', err.message);
    throw err;
  }
}

/**
 * ROTA DA API: Obter configurações persistentes do Vigia IA
 */
app.get('/api/ia/settings', (req, res) => {
  res.json(getAiSettings());
});

/**
 * ROTA DA API: Salvar configurações persistentes do Vigia IA
 */
app.post('/api/ia/settings', (req, res) => {
  try {
    const saved = saveAiSettings(req.body);
    res.json({ success: true, settings: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ROTA WEB: Laboratório de Testes de Inteligência Artificial Local
 */
app.get('/ia', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/ia.html'));
});

/**
 * ROTA DA API: Captura de quadro instantâneo para análise da IA (com fallback inteligente)
 */
app.get('/api/ia/snapshot/:camId', async (req, res) => {
  const cam = config.cameras[req.params.camId];
  if (!cam) return res.status(404).json({ error: 'Câmera não encontrada' });

  // Método 1: Captura Sofia XMeye nativa ultra-rápida
  try {
    const snap = await XMeyeClient.getSnapshot(cam, 2000);
    res.setHeader('Content-Type', 'image/jpeg');
    return res.send(snap);
  } catch (err) {
    // Falha silenciosa no Sofia, tenta fallback FFmpeg abaixo
  }

  // Método 2: Fallback via FFmpeg RTSP
  try {
    const rtspUrl = config.buildRtspUrl(cam, { subtype: 1 }); // Substream rápido para IA
    const ffmpeg = spawn(ffmpegPath, [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-vframes', '1',
      '-q:v', '3',
      '-f', 'image2',
      '-c:v', 'mjpeg',
      '-'
    ], { windowsHide: true });

    res.setHeader('Content-Type', 'image/jpeg');
    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      if (!res.headersSent) res.status(504).json({ error: 'Timeout no snapshot' });
    }, 4000);

    ffmpeg.stdout.pipe(res);
    ffmpeg.on('close', () => clearTimeout(timeout));
    ffmpeg.on('error', (e) => {
      clearTimeout(timeout);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    });
  } catch (fallbackErr) {
    if (!res.headersSent) res.status(500).json({ error: fallbackErr.message });
  }
});

/**
 * GERENCIADOR DE EVENTOS EM TEMPO REAL (SSE) PARA SMART TVS E DASHBOARDS
 * Permite que qualquer TV ou tela conectada receba e dispare alertas sonoros/visuais na hora
 */
const sseClients = new Set();

function broadcastIaAlert(alertData) {
  const payload = JSON.stringify({
    ...alertData,
    timestamp: alertData.timestamp || new Date().toISOString()
  });

  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

/**
 * ROTA SSE: Stream de Eventos em Tempo Real para Smart TVs e Dashboards
 */
app.get('/api/ia/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Envia confirmação de conexão ativa
  res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

/**
 * ROTA DA API: Notificar Alarme de IA para todas as TVs / Dashboards conectados
 */
app.post('/api/ia/alert', (req, res) => {
  const { camId, targetClass, duration } = req.body;
  const alertData = {
    type: 'alarm',
    camId: camId || 'cam2',
    targetClass: targetClass || 'person',
    duration: duration || 5,
    timestamp: new Date().toISOString()
  };

  console.log(`[IA VIGIA 🚨] Transmitindo alarme para ${sseClients.size} tela(s) / TV(s) conectadas (${alertData.camId} - ${alertData.targetClass} - ${alertData.duration}s)`);
  broadcastIaAlert(alertData);

  // Disparo automático do Smart Life / Tuya se configurado e habilitado
  if (tuyaService.config.enabled) {
    tuyaService.triggerAlarm().catch(err => {
      console.error('[IA VIGIA -> Smart Life] Erro ao disparar automação:', err.message);
    });
  }

  res.json({ success: true, clientsNotified: sseClients.size });
});

/**
 * ROTAS DA API: Integração Smart Life / Tuya
 */
app.get('/api/tuya/config', (req, res) => {
  res.json(tuyaService.getPublicConfig());
});

app.post('/api/tuya/config', (req, res) => {
  try {
    const result = tuyaService.saveConfig(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tuya/devices', async (req, res) => {
  try {
    const devices = await tuyaService.listDevices();
    res.json({ success: true, devices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tuya/control', async (req, res) => {
  try {
    const { deviceId, powerOn } = req.body;
    const result = await tuyaService.controlDevice(deviceId, powerOn);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tuya/blink', async (req, res) => {
  try {
    const { deviceId, times, intervalMs } = req.body;
    const result = await tuyaService.blinkDevice(deviceId, times || 3, intervalMs || 700);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tuya/scenes', async (req, res) => {
  try {
    const scenes = await tuyaService.listScenes();
    res.json({ success: true, scenes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tuya/trigger', async (req, res) => {
  try {
    const sceneId = req.body.sceneId || null;
    const result = await tuyaService.triggerScene(sceneId);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ROTA DA API: Disparo de Alerta Externo (Webhook / Campainha Tuya / Home Assistant)
 * Executado pelo servidor para evitar restrições de CORS e SSL misto do navegador
 */
app.post('/api/ia/trigger-webhook', async (req, res) => {
  const { url, eventName, targetClass, duration, camId } = req.body;

  // Transmite imediatamente o alarme para as TVs conectadas
  broadcastIaAlert({
    type: 'alarm',
    camId: camId || 'cam2',
    targetClass: targetClass || 'person',
    duration: duration || 5
  });

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL do webhook é obrigatória' });
  }

  console.log(`[IA VIGIA 🚨] Disparando alerta externo para: ${url} (Evento: ${eventName || 'Permanência'} - ${targetClass})`);

  try {
    const payload = {
      event: eventName || 'loitering_alert',
      camera: camId || 'cam2',
      target: targetClass || 'person',
      durationSeconds: duration || 5,
      timestamp: new Date().toISOString()
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    res.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText
    });
  } catch (err) {
    console.error('[IA VIGIA] Erro ao chamar webhook:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

/**
 * ROTA DA API: Listar gravações salvas no equipamento (Cartão SD / Memória)
 */
const PlaybackManager = require('./playback');
app.get('/api/recordings/:camId', async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const data = await PlaybackManager.listRecordings(req.params.camId, dateStr);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ROTA DA API: Transmitir vídeo gravado sob demanda (Streaming / Download MP4)
 */
app.get('/api/recordings/:camId/stream', async (req, res) => {
  const { fileName, startTime, endTime, download } = req.query;
  if (!fileName || !startTime || !endTime) {
    return res.status(400).json({ error: 'Parâmetros fileName, startTime e endTime são obrigatórios' });
  }

  try {
    const mp4Path = await PlaybackManager.fetchClipAsMp4(req.params.camId, fileName, startTime, endTime);
    if (download === '1') {
      const cleanName = `${req.params.camId}_${startTime.replace(/[: ]/g, '_')}.mp4`;
      res.download(mp4Path, cleanName);
    } else {
      res.sendFile(mp4Path);
    }
  } catch (err) {
    res.status(500).json({ error: 'Falha ao recuperar gravação: ' + err.message });
  }
});

/**
 * ROTA DA API: Status em tempo real das câmeras e conectividade
 */
app.get('/api/status', (req, res) => {
  res.json(streamRelay.getStatus());
});

const CameraScanner = require('./scanner');
const StreamValidator = require('./validator');

/**
 * ROTA DA API: Comparação e auditoria de sincronia (Sensor vs Stream)
 */
app.get('/api/compare', async (req, res) => {
  try {
    const [cam1, cam2] = await Promise.allSettled([
      StreamValidator.validateCamera('cam1'),
      StreamValidator.validateCamera('cam2')
    ]);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      cameras: {
        cam1: cam1.status === 'fulfilled' ? cam1.value : { error: cam1.reason.message },
        cam2: cam2.status === 'fulfilled' ? cam2.value : { error: cam2.reason.message }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ROTA DA API: Varredura de dispositivos XMeye na rede local
 */
app.get('/api/scan', async (req, res) => {
  try {
    const devices = await CameraScanner.scanAll(34567);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      devices
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ROTA DA API: Forçar re-verificação de conectividade imediata
 */
app.post('/api/check', async (req, res) => {
  await Promise.all([
    streamRelay.runHealthCheck('cam1'),
    streamRelay.runHealthCheck('cam2')
  ]);
  res.json(streamRelay.getStatus());
});

/**
 * ROTA DA API: Configurações públicas (sem credenciais sensíveis)
 */
app.get('/api/config', (req, res) => {
  const localIps = getLocalIpAddresses();
  const wifiIp = localIps.find(i => /wi-fi|wireless|wlan/i.test(i.name)) || localIps[0];

  res.json({
    port: config.port,
    localIps,
    primaryIp: wifiIp ? wifiIp.ip : 'localhost',
    cameras: {
      cam1: {
        id: 'cam1',
        name: config.cameras.cam1.name,
        host: config.cameras.cam1.host,
        port: config.cameras.cam1.port,
        rtspUrlMasked: config.sanitizeRtspUrl(config.buildRtspUrl(config.cameras.cam1)),
        description: config.cameras.cam1.description
      },
      cam2: {
        id: 'cam2',
        name: config.cameras.cam2.name,
        host: config.cameras.cam2.host,
        port: config.cameras.cam2.port,
        rtspUrlMasked: config.sanitizeRtspUrl(config.buildRtspUrl(config.cameras.cam2)),
        description: config.cameras.cam2.description
      }
    }
  });
});

const XMeyeClient = require('./xmeye-client');

/**
 * ROTA DA API: Captura de snapshot HD direto do fluxo RTSP ou nativo XMeye via porta 34567
 */
app.get('/api/snapshot/:camId', async (req, res) => {
  const { camId } = req.params;
  const cam = config.cameras[camId];

  if (!cam) {
    return res.status(404).json({ error: 'Câmera não encontrada' });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Disposition', `inline; filename="snapshot-${camId}-${Date.now()}.jpg"`);

  // Método 1: Tenta captura direta via protocolo nativo XMeye (porta 34567) - Ultra-rápido (~100ms)
  try {
    const snapBuffer = await XMeyeClient.getSnapshot({
      host: cam.host,
      port: 34567,
      user: cam.user,
      pass: cam.pass
    }, 2500);
    return res.end(snapBuffer);
  } catch (xmeyeErr) {
    // Se falhar ou a câmera não suportar Sofia na 34567, faz fallback para FFmpeg RTSP
  }

  // Método 2: Fallback via FFmpeg RTSP (porta 554)
  const rtspUrl = config.buildRtspUrl(cam, { subtype: 0 });
  const ffmpeg = spawn(ffmpegPath, [
    '-rtsp_transport', 'tcp',
    '-i', rtspUrl,
    '-vframes', '1',
    '-q:v', '2',
    '-f', 'image2',
    '-c:v', 'mjpeg',
    '-'
  ], { windowsHide: true });

  const timeout = setTimeout(() => {
    ffmpeg.kill('SIGKILL');
    if (!res.headersSent) {
      res.status(504).json({ error: 'Tempo limite ao capturar snapshot da câmera' });
    }
  }, 5000);

  ffmpeg.stdout.pipe(res);

  ffmpeg.on('close', () => {
    clearTimeout(timeout);
  });

  ffmpeg.on('error', (err) => {
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Falha ao executar snapshot', details: err.message });
    }
  });
});

/**
 * CANAIS WEBSOCKET: Streaming de vídeo para JSMpeg
 */
app.ws('/api/stream/cam1', streamRelay.createStreamHandler('cam1'));
app.ws('/api/stream/cam2', streamRelay.createStreamHandler('cam2'));

// Rota de fallback para SPA / interface
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Inicialização do servidor
const PORT = config.port;
server.listen(PORT, () => {
  const localIps = getLocalIpAddresses();
  console.log('====================================================');
  console.log('  📹 CFTV DASHBOARD — CENTRAL DE MONITORAMENTO WEB');
  console.log('====================================================');
  console.log(`  💻 No seu PC:           http://localhost:${PORT}`);
  localIps.forEach(net => {
    console.log(`  📱 No Celular / Wi-Fi:  http://${net.ip}:${PORT}  (${net.name})`);
  });
  console.log(`  🕒 Iniciado em:          ${new Date().toLocaleString('pt-BR')}`);
  console.log('----------------------------------------------------');
  console.log(`  📡 Câmera 1 (Fundos):   ${config.cameras.cam1.host}:${config.cameras.cam1.port}`);
  console.log(`     URL: ${config.sanitizeRtspUrl(config.buildRtspUrl(config.cameras.cam1))}`);
  console.log(`  📡 Câmera 2 (Entrada):  ${config.cameras.cam2.host}:${config.cameras.cam2.port}`);
  console.log(`     URL: ${config.sanitizeRtspUrl(config.buildRtspUrl(config.cameras.cam2))}`);
  console.log('----------------------------------------------------');
  console.log('  💡 Pressione CTRL+C para encerrar o servidor.');
  console.log('====================================================');
});
