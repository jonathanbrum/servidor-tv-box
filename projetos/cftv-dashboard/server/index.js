const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('./ffmpeg-path');
const config = require('./config');
const XMeyeClient = require('./xmeye-client');
const StreamRelayManager = require('./stream-relay');
const tuyaService = require('./tuya');
const notifier = require('./notifier');

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

// Middlewares para JSON e arquivos estáticos (prioriza dist/ do Vite quando construído)
app.use(express.json());

const distDir = path.join(__dirname, '../dist');
const publicDir = path.join(__dirname, '../public');

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}
app.use(express.static(publicDir));

/**
 * PERSISTÊNCIA DAS CONFIGURAÇÕES DO VIGIA IA
 * Salva no arquivo server/ai-settings.json para manter sincronizado com TVs, celulares e reinicializações
 */
const AI_SETTINGS_FILE = path.join(__dirname, 'ai-settings.json');

const DEFAULT_AI_SETTINGS = {
  masterVigia: false, // Por padrão desligado (sob demanda econômico)
  vigiaDurationHours: 4, // Janela padrão sugerida (ex: 4h, suportando 0.5h até 12h)
  vigiaActiveUntil: null, // Timestamp ms de encerramento automático (null = inativo ou contínuo)
  camId: 'cam2',
  sourceType: 'live-cam',
  sourceTitle: 'CAM 2 (Entrada - Ao Vivo)',
  roi: { x: 0.15, y: 0.20, w: 0.70, h: 0.65 },
  durationSeconds: 5.0, // Segundos de permanência no portão para confirmar campainha
  confidence: 55,
  enabledClasses: ['person', 'car', 'motorcycle'],
  soundAlert: true,
  windowsNotify: true,
  webhookUrl: ''
};

function withVigiaMeta(settings) {
  const remainingSeconds = (settings.masterVigia && settings.vigiaActiveUntil)
    ? Math.max(0, Math.round((settings.vigiaActiveUntil - Date.now()) / 1000))
    : null;

  return {
    ...settings,
    remainingSeconds,
    serverTime: Date.now()
  };
}

function getAiSettings() {
  try {
    if (fs.existsSync(AI_SETTINGS_FILE)) {
      const data = fs.readFileSync(AI_SETTINGS_FILE, 'utf8');
      const raw = JSON.parse(data);
      const { remainingSeconds: _rs, serverTime: _st, ...cleanRaw } = raw;
      const settings = { ...DEFAULT_AI_SETTINGS, ...cleanRaw };

      // Se passou da janela temporária configurada (ex: 30m, 1h, 4h, 12h), desativa automaticamente
      if (settings.masterVigia && settings.vigiaActiveUntil && Date.now() > settings.vigiaActiveUntil) {
        settings.masterVigia = false;
        settings.vigiaActiveUntil = null;
        try {
          fs.writeFileSync(AI_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
          console.log('[AI Vigia] Janela temporária expirada. Monitoramento desativado automaticamente para poupar o servidor.');
        } catch (e) {}
      }

      return withVigiaMeta(settings);
    }
  } catch (err) {
    console.warn('[AI Settings] Erro ao ler ai-settings.json:', err.message);
  }
  return withVigiaMeta({ ...DEFAULT_AI_SETTINGS });
}

function saveAiSettings(newSettings) {
  try {
    const { remainingSeconds: _rs1, serverTime: _st1, ...cleanCurrent } = getAiSettings();
    const { remainingSeconds: _rs2, serverTime: _st2, ...cleanNew } = newSettings || {};
    const updated = { ...cleanCurrent, ...cleanNew };

    // Se o usuário ativou o vigia e informou a duração desejada (em horas ou minutos)
    if (cleanNew.masterVigia === true) {
      const hours = cleanNew.vigiaDurationHours !== undefined
        ? Number(cleanNew.vigiaDurationHours)
        : Number(cleanCurrent.vigiaDurationHours ?? 4);
      if (Number.isFinite(hours) && hours > 0) {
        updated.vigiaDurationHours = hours;
        updated.vigiaActiveUntil = Date.now() + Math.round(hours * 3600 * 1000);
      } else {
        // 0 horas = contínuo (até desativar manualmente)
        updated.vigiaDurationHours = 0;
        updated.vigiaActiveUntil = null;
      }
    } else if (cleanNew.masterVigia === false) {
      updated.vigiaActiveUntil = null;
    }

    fs.writeFileSync(AI_SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return withVigiaMeta(updated);
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
 * Captura um snapshot JPEG em memória da câmera (XMeye nativo ~100ms, com fallback FFmpeg RTSP).
 */
async function captureSnapshotBuffer(camId, { subtype = 1, timeoutMs = 4000, quality = 3 } = {}) {
  const cam = config.cameras[camId];
  if (!cam) {
    throw new Error('Câmera não encontrada');
  }

  try {
    return await XMeyeClient.getSnapshot({
      host: cam.host,
      port: 34567,
      user: cam.user,
      pass: cam.pass
    }, Math.min(timeoutMs, 2500));
  } catch (xmeyeErr) {
    // Fallback via FFmpeg RTSP caso a porta 34567 não responda
  }

  return new Promise((resolve, reject) => {
    const rtspUrl = config.buildRtspUrl(cam, { subtype });
    const ffmpeg = spawn(ffmpegPath, [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-vframes', '1',
      '-q:v', String(quality),
      '-f', 'image2',
      '-c:v', 'mjpeg',
      '-'
    ], { windowsHide: true });

    const chunks = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ffmpeg.kill('SIGKILL');
      reject(new Error('Tempo limite ao capturar snapshot da câmera'));
    }, timeoutMs);

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      const buf = Buffer.concat(chunks);
      if (buf.length > 0) {
        resolve(buf);
      } else {
        reject(new Error(`FFmpeg encerrou sem imagem (código ${code})`));
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * ROTA DA API: Captura de quadro instantâneo para análise da IA (com fallback inteligente)
 */
app.get('/api/ia/snapshot/:camId', async (req, res) => {
  if (!config.cameras[req.params.camId]) {
    return res.status(404).json({ error: 'Câmera não encontrada' });
  }
  try {
    const snap = await captureSnapshotBuffer(req.params.camId, { subtype: 1, timeoutMs: 4000, quality: 3 });
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(snap);
  } catch (err) {
    res.status(err.message.includes('limite') ? 504 : 500).json({ error: err.message });
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
 * Função Auxiliar para Disparo de Webhooks Externos (Home Assistant, Node-RED, etc.)
 */
async function sendWebhookAlert(url, payload) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText
    };
  } catch (err) {
    console.warn(`[IA VIGIA -> Webhook] Falha ao enviar para ${url}:`, err.message);
    return { ok: false, error: err.message };
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
  const { camId, targetClass, duration, force } = req.body;
  const alertData = {
    type: 'alarm',
    camId: camId || 'cam2',
    targetClass: targetClass || 'person',
    duration: duration || 5,
    force: Boolean(force),
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

  // Disparo automático de Webhook se configurado nas opções da IA
  const aiCfg = getAiSettings();
  if (aiCfg.webhookUrl) {
    sendWebhookAlert(aiCfg.webhookUrl, {
      event: 'loitering_alert',
      camera: alertData.camId,
      target: alertData.targetClass,
      durationSeconds: alertData.duration,
      timestamp: alertData.timestamp
    }).catch(() => {});
  }

  // Disparo automático de notificações multiplataforma (Windows Toast / ntfy Android / Telegram)
  notifier.dispatchAlert(alertData, {
    force: Boolean(force),
    getSnapshot: () => captureSnapshotBuffer(alertData.camId, { subtype: 1, timeoutMs: 3000, quality: 3 })
  }).catch((err) => {
    console.warn('[IA VIGIA -> Notifier] Erro ao despachar notificações:', err.message);
  });

  res.json({ success: true, clientsNotified: sseClients.size });
});

/**
 * ROTAS DA API: Notificações Push (Windows Toast, ntfy.sh Android/PC, Telegram Bot)
 */
app.get('/api/notify/config', (req, res) => {
  res.json(notifier.getPublicConfig());
});

app.post('/api/notify/config', (req, res) => {
  try {
    res.json(notifier.saveConfig(req.body));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/notify/test', async (req, res) => {
  try {
    const { channel, camId } = req.body || {};
    const targetCam = config.cameras[camId] ? camId : 'cam2';
    const result = await notifier.testChannel(channel, {
      getSnapshot: () => captureSnapshotBuffer(targetCam, { subtype: 1, timeoutMs: 3000, quality: 3 })
    });
    if (result.ok) {
      res.json({ success: true, channel });
    } else {
      res.status(400).json({ success: false, channel, error: result.error || 'Falha ao enviar teste' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
  const aiCfg = getAiSettings();
  const targetUrl = url || aiCfg.webhookUrl;

  if (!targetUrl) {
    return res.status(400).json({ success: false, error: 'Nenhuma URL de webhook configurada. Defina uma URL primeiro.' });
  }

  console.log(`[IA VIGIA 🚨] Testando webhook para: ${targetUrl} (Evento: ${eventName || 'Teste'} - ${targetClass})`);

  const payload = {
    event: eventName || 'loitering_alert',
    camera: camId || 'cam2',
    target: targetClass || 'person',
    durationSeconds: duration || 5,
    timestamp: new Date().toISOString()
  };

  const result = await sendWebhookAlert(targetUrl, payload);
  if (result && result.ok) {
    res.json({ success: true, url: targetUrl, status: result.status, statusText: result.statusText });
  } else {
    res.status(result?.status || 502).json({
      success: false,
      url: targetUrl,
      error: result?.error || `Falha HTTP ${result?.status}: ${result?.statusText}`
    });
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

/**
 * ROTA DA API: Captura de snapshot HD direto do fluxo RTSP ou nativo XMeye via porta 34567
 */
app.get('/api/snapshot/:camId', async (req, res) => {
  const { camId } = req.params;
  if (!config.cameras[camId]) {
    return res.status(404).json({ error: 'Câmera não encontrada' });
  }

  try {
    const snapBuffer = await captureSnapshotBuffer(camId, { subtype: 0, timeoutMs: 5000, quality: 2 });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="snapshot-${camId}-${Date.now()}.jpg"`);
    res.end(snapBuffer);
  } catch (err) {
    res.status(err.message.includes('limite') ? 504 : 500).json({
      error: 'Falha ao executar snapshot',
      details: err.message
    });
  }
});

/**
 * CANAIS WEBSOCKET: Streaming de vídeo para JSMpeg
 */
app.ws('/api/stream/cam1', streamRelay.createStreamHandler('cam1'));
app.ws('/api/stream/cam2', streamRelay.createStreamHandler('cam2'));

// Rota de fallback para SPA / interface (prioriza dist/index.html do Vite)
app.get('*', (req, res) => {
  const distIndex = path.join(distDir, 'index.html');
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else {
    res.sendFile(path.join(publicDir, 'index.html'));
  }
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
