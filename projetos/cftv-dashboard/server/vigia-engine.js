const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');

const MODEL_CACHE_DIR = path.join(__dirname, 'models', 'ssdlite_mobilenet_v2');
const MODEL_REMOTE_BASE = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/';
const DIAG_DIR = path.join(__dirname, 'vigia-diagnostics');
const DIAG_INDEX_FILE = path.join(DIAG_DIR, 'index.json');
const DIAG_MAX_ITEMS = 30;

const COCO_TO_SETTING_CLASS = {
  person: 'person',
  car: 'car',
  truck: 'car',
  bus: 'car',
  motorcycle: 'motorcycle',
  bicycle: 'motorcycle',
  dog: 'animal',
  cat: 'animal'
};

const DEFAULT_FENCE = [
  { x: 55, y: 290 },
  { x: 180, y: 175 },
  { x: 470, y: 190 },
  { x: 565, y: 320 },
  { x: 230, y: 345 }
];

function isPointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Baixa e armazena em cache local os arquivos do modelo ssdlite_mobilenet_v2 para uso 100% offline.
 */
async function ensureLocalModelCache() {
  const manifestPath = path.join(MODEL_CACHE_DIR, 'model.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const shards = manifest.weightsManifest?.flatMap((g) => g.paths || []) || [];
    const allPresent = shards.every((s) => fs.existsSync(path.join(MODEL_CACHE_DIR, s)));
    if (allPresent) return manifestPath;
  }

  fs.mkdirSync(MODEL_CACHE_DIR, { recursive: true });
  const res = await fetch(`${MODEL_REMOTE_BASE}model.json`);
  if (!res.ok) throw new Error(`Falha ao baixar model.json: HTTP ${res.status}`);
  const modelJsonText = await res.text();
  const manifest = JSON.parse(modelJsonText);

  const shards = manifest.weightsManifest?.flatMap((g) => g.paths || []) || [];
  for (const shardName of shards) {
    const shardRes = await fetch(`${MODEL_REMOTE_BASE}${shardName}`);
    if (!shardRes.ok) throw new Error(`Falha ao baixar shard ${shardName}: HTTP ${shardRes.status}`);
    const buf = Buffer.from(await shardRes.arrayBuffer());
    fs.writeFileSync(path.join(MODEL_CACHE_DIR, shardName), buf);
  }

  fs.writeFileSync(manifestPath, modelJsonText, 'utf8');
  return manifestPath;
}

/**
 * Cria um IOHandler do TensorFlow.js para ler model.json e shards direto do disco local.
 */
function createDiskIoHandler(manifestPath) {
  return {
    load: async () => {
      const modelJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const weightSpecs = [];
      const buffers = [];

      for (const group of modelJson.weightsManifest || []) {
        weightSpecs.push(...(group.weights || []));
        for (const shardRel of group.paths || []) {
          buffers.push(fs.readFileSync(path.join(path.dirname(manifestPath), shardRel)));
        }
      }

      const combined = Buffer.concat(buffers);
      const weightData = combined.buffer.slice(
        combined.byteOffset,
        combined.byteOffset + combined.byteLength
      );

      return {
        modelTopology: modelJson.modelTopology,
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy,
        weightSpecs,
        weightData
      };
    }
  };
}

/**
 * Motor Vigia em 2 Etapas rodando no servidor (TV Box / PC):
 * - Etapa 1: Detector leve de movimento em pixels dentro da cerca virtual (jpeg-js, ~0% CPU em repouso)
 * - Etapa 2: Confirmação via COCO-SSD WASM (lite_mobilenet_v2) apenas quando houver movimento
 */
class VigiaEngine {
  constructor({ getSettings, captureSnapshot, onStatus, onAlarm, getCooldownSeconds }) {
    this.getSettings = getSettings;
    this.captureSnapshot = captureSnapshot;
    this.onStatus = onStatus;
    this.onAlarm = onAlarm;
    this.getCooldownSeconds = getCooldownSeconds;

    this.tf = null;
    this.model = null;
    this.modelPromise = null;
    this.running = false;
    this.timerId = null;

    // Estado da Etapa 1 (movimento e calibração dinâmica)
    this.prevFenceKey = '';
    this.prevLuma = null;
    this.activeMotionUntil = 0;
    this.lastMotionAt = 0; // Timestamp do último movimento acima do piso

    // Memória de calibração supervisionada pela IA
    // Guarda amostras recentes { pct: number, isTarget: boolean, timestamp: number }
    this.motionHistory = [];
    this.currentThreshold = 1.5;

    // Estado da Etapa 2 (permanência, tracking de presença contínua e alarme)
    this.loiterStartAt = null;
    this.lastAlarmAt = 0;
    this.trackingActiveUntil = 0; // Mantém a IA ativa mesmo se o alvo ficar imóvel
    this.lastConfirmedTarget = null; // Último objeto confirmado pela IA
    this.lastDiagAt = 0; // Throttle dos prints de diagnóstico de descarte

    this.status = {
      enabled: false,
      stage: 'idle',
      modelLoaded: false,
      modelLoading: false,
      motionPct: 0,
      motionThresholdPct: 1.5,
      motionBaselinePct: 0.5,
      isTracking: false,
      lastCheckAt: null,
      lastInferenceMs: null,
      detection: null,
      message: 'Vigia em repouso econômico'
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(1500);
  }

  stop() {
    this.running = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  scheduleNext(ms) {
    if (!this.running) return;
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = setTimeout(() => this.tick(), ms);
  }

  getStatus() {
    return { ...this.status };
  }

  updateStatus(patch) {
    this.status = { ...this.status, ...patch };
    if (typeof this.onStatus === 'function') {
      this.onStatus(this.getStatus());
    }
  }

  async ensureModel() {
    if (this.model) return this.model;
    if (this.modelPromise) return this.modelPromise;

    this.updateStatus({
      modelLoading: true,
      stage: 'loading-model',
      message: 'Carregando modelo IA local (WASM)...'
    });

    this.modelPromise = (async () => {
      const tf = require('@tensorflow/tfjs-core');
      require('@tensorflow/tfjs-converter');
      const { setWasmPaths, setThreadsCount } = require('@tensorflow/tfjs-backend-wasm');
      const cocoSsd = require('@tensorflow-models/coco-ssd');

      const wasmDist = path.join(
        path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')),
        'dist'
      ) + path.sep;
      setWasmPaths(`file://${wasmDist}`);
      setThreadsCount(1);
      await tf.setBackend('wasm');
      await tf.ready();

      let model;
      try {
        const manifestPath = await ensureLocalModelCache();
        model = await cocoSsd.load({
          base: 'lite_mobilenet_v2',
          modelUrl: createDiskIoHandler(manifestPath)
        });
      } catch (cacheErr) {
        console.warn('[VigiaEngine] Cache local falhou, carregando remoto:', cacheErr.message);
        model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      }

      this.tf = tf;
      this.model = model;
      this.updateStatus({
        modelLoaded: true,
        modelLoading: false,
        message: 'IA local pronta (2 etapas)'
      });
      console.log('[VigiaEngine] ✅ COCO-SSD WASM (lite_mobilenet_v2) pronto no servidor!');
      return model;
    })();

    try {
      return await this.modelPromise;
    } catch (err) {
      this.updateStatus({
        modelLoading: false,
        stage: 'error',
        message: `Erro ao carregar IA: ${err.message}`
      });
      throw err;
    } finally {
      this.modelPromise = null;
    }
  }

  disposeModel() {
    this.prevLuma = null;
    this.prevFenceKey = '';
    this.loiterStartAt = null;
    this.activeMotionUntil = 0;
    this.trackingActiveUntil = 0;
    this.lastConfirmedTarget = null;
    this.motionHistory = [];

    if (this.model) {
      try {
        this.model.dispose();
      } catch {}
      this.model = null;
      console.log('[VigiaEngine] Modelo IA descarregado para liberar RAM.');
    }
    this.updateStatus({
      enabled: false,
      stage: 'idle',
      modelLoaded: false,
      modelLoading: false,
      motionPct: 0,
      isTracking: false,
      detection: null,
      message: 'Vigia em repouso econômico'
    });
  }

  /**
   * Adiciona uma amostra no histórico da calibração supervisionada pela IA
   */
  recordMotionSample(pct, isTarget, cfg) {
    const now = Date.now();
    const sampleWindowMs = Math.max(5, Number(cfg?.motionSampleWindowMinutes ?? 30)) * 60 * 1000;
    const maxSamples = Math.max(3, Number(cfg?.motionSampleSize ?? 10));

    // Limpa amostras expiradas pela janela de tempo
    this.motionHistory = this.motionHistory.filter(s => now - s.timestamp <= sampleWindowMs);

    this.motionHistory.push({ pct, isTarget, timestamp: now });
    if (this.motionHistory.length > maxSamples * 2) {
      this.motionHistory.splice(0, this.motionHistory.length - maxSamples * 2);
    }
  }

  /**
   * Calcula o limiar ótimo auto-calibrado respeitando o piso, o teto e o decaimento por repouso
   */
  computeDynamicThreshold(cfg) {
    const minFloor = Number(cfg?.motionMinThreshold ?? 1.5);
    const maxCeiling = Number(cfg?.motionMaxThreshold ?? 15.0);
    const margin = Number(cfg?.motionMarginOffset ?? 0.8);
    const decayMinutes = Math.max(1, Number(cfg?.motionDecayMinutes ?? 5));
    const now = Date.now();

    // Se o usuário desativou a auto-calibração, usa o piso mínimo configurado diretamente
    if (cfg?.motionAutoCalibrate === false) {
      this.currentThreshold = minFloor;
      return { threshold: minFloor, baseline: minFloor };
    }

    // Filtra amostras dentro da janela
    const sampleWindowMs = Math.max(5, Number(cfg?.motionSampleWindowMinutes ?? 30)) * 60 * 1000;
    const validSamples = this.motionHistory.filter(s => now - s.timestamp <= sampleWindowMs);

    // Amostras onde a IA descartou (falsos positivos como vento, luz, árvores)
    const falsePositives = validSamples.filter(s => !s.isTarget).map(s => s.pct);

    let baseline = minFloor;
    if (falsePositives.length > 0) {
      // Pega o maior ruído recente descartado
      const maxNoise = Math.max(...falsePositives);
      baseline = Math.round(maxNoise * 10) / 10;
    }

    let calculated = baseline + margin;

    // Recalibração por baixo (Decaimento suave quando o ambiente se acalma)
    const timeSinceLastMotionMs = now - (this.lastMotionAt || now);
    const decayPeriodMs = decayMinutes * 60 * 1000;
    if (timeSinceLastMotionMs > decayPeriodMs && calculated > minFloor) {
      // Quanto mais tempo quieto, mais o limiar desce gradualmente em direção ao piso
      const factor = Math.min(1, (timeSinceLastMotionMs - decayPeriodMs) / decayPeriodMs);
      calculated = calculated - (calculated - minFloor) * factor * 0.5;
    }

    // Trava estritamente entre o Piso Mínimo e o Teto Máximo configurados pelo usuário
    const finalThreshold = Math.max(minFloor, Math.min(maxCeiling, Math.round(calculated * 10) / 10));
    this.currentThreshold = finalThreshold;

    return {
      threshold: finalThreshold,
      baseline
    };
  }

  /**
   * Etapa 1: Amostra uma grade 60x36 dentro da cerca e calcula % de pixels alterados.
   */
  detectFenceMotion(raw, poly, camId, cfg) {
    const { width, height, data } = raw;
    const fenceKey = `${camId}:${width}x${height}:${JSON.stringify(poly)}`;
    const cols = 60;
    const rows = 36;
    const stepX = Math.max(1, Math.floor(width / cols));
    const stepY = Math.max(1, Math.floor(height / rows));
    const scaleX = 600 / width;
    const scaleY = 360 / height;

    const current = [];
    for (let y = Math.floor(stepY / 2); y < height; y += stepY) {
      for (let x = Math.floor(stepX / 2); x < width; x += stepX) {
        if (!isPointInPoly({ x: x * scaleX, y: y * scaleY }, poly)) continue;
        const idx = (y * width + x) * 4;
        const luma = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
        current.push(luma);
      }
    }

    if (
      this.prevFenceKey !== fenceKey ||
      !this.prevLuma ||
      this.prevLuma.length !== current.length
    ) {
      this.prevFenceKey = fenceKey;
      this.prevLuma = current;
      return { hasMotion: false, motionPct: 0, baseline: true, threshold: this.currentThreshold };
    }

    let changed = 0;
    for (let i = 0; i < current.length; i++) {
      if (Math.abs(current[i] - this.prevLuma[i]) > 24) {
        changed++;
      }
    }
    this.prevLuma = current;

    const total = Math.max(1, current.length);
    const ratio = changed / total;
    const motionPct = Math.round(ratio * 1000) / 10;

    const { threshold, baseline } = this.computeDynamicThreshold(cfg);
    const targetRatio = threshold / 100;
    const minPixels = Math.max(6, Math.round(total * targetRatio));

    const hasMotion = ratio >= targetRatio || changed >= minPixels;
    if (hasMotion) {
      this.lastMotionAt = Date.now();
    }

    return { hasMotion, motionPct, baseline: false, threshold, baselineNoise: baseline };
  }

  getDiagnostics() {
    try {
      if (!fs.existsSync(DIAG_INDEX_FILE)) return [];
      const parsed = JSON.parse(fs.readFileSync(DIAG_INDEX_FILE, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  clearDiagnostics() {
    try {
      if (fs.existsSync(DIAG_DIR)) {
        for (const f of fs.readdirSync(DIAG_DIR)) {
          fs.unlinkSync(path.join(DIAG_DIR, f));
        }
      }
    } catch {}
    return [];
  }

  saveDiagnosticSample({ snapBuf, camId, motionPct, thresholdPct, minConfidence, reason, predictions, inferenceMs }) {
    const now = Date.now();
    if (now - this.lastDiagAt < 10000) return; // Máximo 1 print a cada 10s
    this.lastDiagAt = now;

    try {
      fs.mkdirSync(DIAG_DIR, { recursive: true });
      const id = `diag_${now}`;
      const jpgPath = path.join(DIAG_DIR, `${id}.jpg`);
      fs.writeFileSync(jpgPath, snapBuf);

      const list = this.getDiagnostics();
      const entry = {
        id,
        timestamp: new Date(now).toISOString(),
        camId,
        motionPct,
        thresholdPct,
        minConfidence,
        reason,
        inferenceMs,
        predictions: (predictions || []).slice(0, 6),
        imageUrl: `/api/ia/diagnostics/${id}.jpg`
      };

      list.unshift(entry);
      while (list.length > DIAG_MAX_ITEMS) {
        const removed = list.pop();
        if (removed?.id) {
          const oldJpg = path.join(DIAG_DIR, `${removed.id}.jpg`);
          if (fs.existsSync(oldJpg)) {
            try { fs.unlinkSync(oldJpg); } catch {}
          }
        }
      }

      fs.writeFileSync(DIAG_INDEX_FILE, JSON.stringify(list, null, 2));
      const predsText = entry.predictions.length > 0
        ? entry.predictions.map(p => `${p.rawClass}:${p.confidence}%${p.insideFence ? '' : '(fora)'}`).join(', ')
        : 'nenhum objeto';
      console.log(`[VigiaDiag 📸] ${camId} | mov=${motionPct}% (limiar=${thresholdPct}%) | minConf=${minConfidence}% | ${reason} | IA=[${predsText}]`);
    } catch (err) {
      console.warn('[VigiaDiag] Falha ao salvar print:', err.message);
    }
  }

  /**
   * Etapa 2: Roda COCO-SSD WASM apenas sobre o quadro com movimento.
   */
  async confirmWithAi(raw, cfg, poly) {
    const model = await this.ensureModel();
    const tf = this.tf;

    const rgb = new Uint8Array(raw.width * raw.height * 3);
    for (let i = 0, j = 0; i < raw.data.length; i += 4, j += 3) {
      rgb[j] = raw.data[i];
      rgb[j + 1] = raw.data[i + 1];
      rgb[j + 2] = raw.data[i + 2];
    }

    const t0 = Date.now();
    const tensor = tf.tensor3d(rgb, [raw.height, raw.width, 3], 'int32');
    let predictions = [];
    try {
      predictions = await model.detect(tensor);
    } finally {
      tensor.dispose();
    }
    const inferenceMs = Date.now() - t0;

    const minScore = (cfg.confidence || 55) / 100;
    const enabled = cfg.enabledClasses || ['person', 'car', 'motorcycle'];
    const scaleX = 600 / raw.width;
    const scaleY = 360 / raw.height;

    let bestMatch = null;
    const rawPredictions = [];
    for (const pred of predictions) {
      const mappedClass = COCO_TO_SETTING_CLASS[pred.class] || null;
      const conf = Math.round(pred.score * 100);

      const [bx, by, bw, bh] = pred.bbox;
      const targetX = bx * scaleX;
      const targetY = by * scaleY;
      const targetW = bw * scaleX;
      const targetH = bh * scaleY;
      const cx = targetX + targetW / 2;
      const feetY = targetY + targetH;
      const cy = targetY + targetH / 2;
      const insideFence = isPointInPoly({ x: cx, y: feetY }, poly) || isPointInPoly({ x: cx, y: cy }, poly);

      if (conf >= 20) {
        rawPredictions.push({
          rawClass: pred.class,
          mappedClass,
          confidence: conf,
          insideFence,
          bbox: {
            x: Math.round(targetX),
            y: Math.round(targetY),
            w: Math.round(targetW),
            h: Math.round(targetH)
          }
        });
      }

      if (!mappedClass || !enabled.includes(mappedClass)) continue;
      if (pred.score < minScore) continue;

      if (insideFence) {
        if (!bestMatch || conf > bestMatch.confidence) {
          bestMatch = {
            targetClass: mappedClass,
            rawClass: pred.class,
            confidence: conf,
            bbox: {
              x: Math.round(targetX),
              y: Math.round(targetY),
              w: Math.round(targetW),
              h: Math.round(targetH)
            }
          };
        }
      }
    }

    return { bestMatch, rawPredictions, inferenceMs };
  }

  async tick() {
    if (!this.running) return;

    let nextDelay = 1500;
    try {
      const cfg = this.getSettings();
      if (!cfg?.masterVigia) {
        if (this.model || this.status.enabled) {
          this.disposeModel();
        }
        this.scheduleNext(2500);
        return;
      }

      if (!this.status.enabled) {
        this.updateStatus({
          enabled: true,
          stage: 'watching',
          message: 'Iniciando Vigia em 2 etapas...'
        });
      }

      // Pré-aquece o modelo em segundo plano assim que o Vigia é ligado
      if (!this.model && !this.modelPromise) {
        this.ensureModel().catch(() => {});
      }

      const camId = cfg.camId || 'cam2';
      const poly =
        Array.isArray(cfg.fencePoints) && cfg.fencePoints.length >= 3
          ? cfg.fencePoints
          : DEFAULT_FENCE;

      const snapBuf = await this.captureSnapshot(camId);
      const raw = jpeg.decode(snapBuf, { useTArray: true });
      const now = Date.now();

      const motion = this.detectFenceMotion(raw, poly, camId, cfg);
      const isTracking = now < this.trackingActiveUntil;

      if (motion.hasMotion) {
        this.activeMotionUntil = now + 7000;
      }

      const inMotionWindow = motion.hasMotion || now < this.activeMotionUntil || isTracking;
      if (!inMotionWindow) {
        this.loiterStartAt = null;
        this.lastConfirmedTarget = null;
        this.updateStatus({
          enabled: true,
          stage: 'watching',
          motionPct: motion.motionPct,
          motionThresholdPct: motion.threshold,
          motionBaselinePct: motion.baselineNoise,
          isTracking: false,
          lastCheckAt: new Date(now).toISOString(),
          detection: null,
          message: motion.baseline
            ? 'Referência da cerca calibrada'
            : `Sem movimento relevante na cerca (${motion.motionPct}% · limiar: ${motion.threshold}%)`
        });
        this.scheduleNext(1500);
        return;
      }

      // Se o modelo ainda estiver carregando na primeira ativação, aguarda suavemente
      if (!this.model) {
        this.updateStatus({
          enabled: true,
          stage: 'loading-model',
          motionPct: motion.motionPct,
          motionThresholdPct: motion.threshold,
          motionBaselinePct: motion.baselineNoise,
          isTracking,
          lastCheckAt: new Date(now).toISOString(),
          message: `Movimento (${motion.motionPct}%) · preparando IA...`
        });
        this.scheduleNext(1500);
        return;
      }

      const { bestMatch, rawPredictions, inferenceMs } = await this.confirmWithAi(raw, cfg, poly);
      const holdSeconds = Math.max(3, Number(cfg?.trackingHoldSeconds ?? 10));

      if (bestMatch) {
        // Supervisionamento da IA: registra que esse nível de movimento conteve alvo real
        this.recordMotionSample(motion.motionPct, true, cfg);

        // Ativa o Hold de Presença (continua rastreando e contando tempo mesmo imóvel)
        this.trackingActiveUntil = now + (holdSeconds * 1000);
        this.lastConfirmedTarget = bestMatch;

        if (!this.loiterStartAt) {
          this.loiterStartAt = now;
        }
        const elapsedSec = Math.max(0.5, (now - this.loiterStartAt) / 1000);
        const requiredSec = Number(cfg.durationSeconds ?? 5);

        this.updateStatus({
          enabled: true,
          stage: 'detected',
          motionPct: motion.motionPct,
          motionThresholdPct: motion.threshold,
          motionBaselinePct: motion.baselineNoise,
          isTracking: true,
          lastCheckAt: new Date(now).toISOString(),
          lastInferenceMs: inferenceMs,
          detection: {
            ...bestMatch,
            duration: Math.round(elapsedSec * 10) / 10,
            camId
          },
          message: `IA confirmou ${bestMatch.targetClass} (${bestMatch.confidence}%) · Permanência: ${Math.round(elapsedSec)}s`
        });

        const cooldownSec = typeof this.getCooldownSeconds === 'function'
          ? Number(this.getCooldownSeconds() ?? 60)
          : 60;
        const cooldownMs = Math.max(12, cooldownSec) * 1000;

        if (elapsedSec >= requiredSec && now - this.lastAlarmAt >= cooldownMs) {
          this.lastAlarmAt = now;
          if (typeof this.onAlarm === 'function') {
            this.onAlarm({
              camId,
              targetClass: bestMatch.targetClass,
              duration: Math.max(1, Math.round(elapsedSec)),
              confidence: bestMatch.confidence
            });
          }
        }
        nextDelay = 1200;
      } else {
        // Se a IA não viu ninguém:
        // Caso estivesse em tracking recente, dá uma tolerância curta antes de resetar permanência
        if (isTracking && this.lastConfirmedTarget) {
          const remainingTracking = Math.round((this.trackingActiveUntil - now) / 1000);
          this.updateStatus({
            enabled: true,
            stage: 'watching',
            motionPct: motion.motionPct,
            motionThresholdPct: motion.threshold,
            motionBaselinePct: motion.baselineNoise,
            isTracking: true,
            lastCheckAt: new Date(now).toISOString(),
            lastInferenceMs: inferenceMs,
            message: `Alvo sumiu da cerca? Revalidando (${remainingTracking}s)...`
          });
          nextDelay = 1200;
        } else {
          // Movimento que a IA confirmou NÃO ser alvo (vento, folhas, iluminação)
          if (motion.motionPct > 0) {
            this.recordMotionSample(motion.motionPct, false, cfg);
          }

          // Salva print + log para auditoria se foi movimento alto (>= 8%) ou se a IA viu alvo abaixo da confiança/fora da cerca
          const minConf = cfg.confidence || 55;
          const enabled = cfg.enabledClasses || ['person', 'car', 'motorcycle'];
          const nearMiss = (rawPredictions || []).some(p => (p.mappedClass && enabled.includes(p.mappedClass) && p.confidence >= 25) || p.confidence >= 40);
          if (motion.motionPct >= 8 || nearMiss) {
            let reason = 'Nenhum objeto reconhecido pela IA';
            if ((rawPredictions || []).some(p => p.mappedClass && enabled.includes(p.mappedClass) && !p.insideFence && p.confidence >= minConf)) {
              reason = 'Objeto detectado fora da cerca virtual';
            } else if ((rawPredictions || []).some(p => p.mappedClass && enabled.includes(p.mappedClass) && p.confidence < minConf)) {
              reason = `Confiança abaixo do mínimo (${minConf}%)`;
            } else if ((rawPredictions || []).length > 0) {
              reason = 'Classe ignorada / abaixo do filtro';
            } else if (motion.motionPct >= 8) {
              reason = `Movimento alto (${motion.motionPct}%) sem detecção`;
            }
            this.saveDiagnosticSample({
              snapBuf,
              camId,
              motionPct: motion.motionPct,
              thresholdPct: motion.threshold,
              minConfidence: minConf,
              reason,
              predictions: rawPredictions,
              inferenceMs
            });
          }

          this.loiterStartAt = null;
          this.lastConfirmedTarget = null;
          this.trackingActiveUntil = 0;

          this.updateStatus({
            enabled: true,
            stage: 'filtered',
            motionPct: motion.motionPct,
            motionThresholdPct: motion.threshold,
            motionBaselinePct: motion.baselineNoise,
            isTracking: false,
            lastCheckAt: new Date(now).toISOString(),
            lastInferenceMs: inferenceMs,
            detection: null,
            message: `Movimento (${motion.motionPct}%) descartado pela IA (Ruído filtrado)`
          });
          nextDelay = 1500;
        }
      }
    } catch (err) {
      this.updateStatus({
        stage: 'error',
        lastCheckAt: new Date().toISOString(),
        message: `Falha na checagem: ${err.message}`
      });
      nextDelay = 3000;
    }

    this.scheduleNext(nextDelay);
  }
}

module.exports = VigiaEngine;
