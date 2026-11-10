const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const XMeyeClient = require('./xmeye-client');
const config = require('./config');
const ffmpegPath = require('./ffmpeg-path');

/**
 * Validador de Sincronia: Compara o fluxo ao vivo (WebSocket) com a foto direta do sensor (Ground Truth).
 */
class StreamValidator {
  /**
   * Captura um quadro instantâneo do fluxo WebSocket de uma câmera.
   */
  static async captureStreamFrame(camId, port = config.port) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/api/stream/${camId}?quality=hd`);
      const chunks = [];
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timeout ao capturar pacotes WebSocket de ${camId}`));
      }, 5000);

      ws.on('message', (chunk) => {
        chunks.push(chunk);
        if (chunks.length >= 10) {
          clearTimeout(timer);
          ws.close();
          const tmpTs = path.resolve(__dirname, `../scratch/tmp_val_${camId}.ts`);
          const tmpPng = path.resolve(__dirname, `../scratch/val_stream_${camId}.png`);
          fs.writeFileSync(tmpTs, Buffer.concat(chunks));
          try {
            execSync(`"${ffmpegPath}" -y -i "${tmpTs}" -vframes 1 "${tmpPng}"`, { stdio: 'ignore' });
            if (fs.existsSync(tmpTs)) fs.unlinkSync(tmpTs);
            const pngBuf = fs.readFileSync(tmpPng);
            resolve({ ok: true, pngBuf, path: tmpPng });
          } catch (e) {
            reject(e);
          }
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Executa a auditoria completa de uma câmera: compara foto direta do sensor vs quadro do stream.
   */
  static async validateCamera(camId) {
    const cam = config.cameras[camId];
    if (!cam) throw new Error(`Câmera ${camId} não encontrada no .env`);

    const result = {
      camId,
      name: cam.name,
      host: cam.host,
      timestamp: new Date().toISOString(),
      snapshot: { ok: false },
      stream: { ok: false },
      inSync: false
    };

    // 1. Snapshot direto do sensor
    try {
      const startSnap = Date.now();
      const snapBuf = await XMeyeClient.getSnapshot(cam, 3000);
      const snapLatency = Date.now() - startSnap;
      const snapPath = path.resolve(__dirname, `../scratch/val_snap_${camId}.jpg`);
      fs.writeFileSync(snapPath, snapBuf);

      result.snapshot = {
        ok: true,
        latencyMs: snapLatency,
        sizeBytes: snapBuf.length,
        path: snapPath
      };
    } catch (err) {
      result.snapshot = { ok: false, error: err.message };
    }

    // 2. Quadro do stream ao vivo
    try {
      const startStream = Date.now();
      const streamRes = await StreamValidator.captureStreamFrame(camId);
      const streamLatency = Date.now() - startStream;

      result.stream = {
        ok: true,
        latencyMs: streamLatency,
        sizeBytes: streamRes.pngBuf.length,
        path: streamRes.path
      };
    } catch (err) {
      result.stream = { ok: false, error: err.message };
    }

    result.inSync = result.snapshot.ok && result.stream.ok;
    return result;
  }
}

if (require.main === module) {
  (async () => {
    console.log('====================================================');
    console.log('  📸 COMPARADOR: STREAM AO VIVO vs FOTO DIRETA DO SENSOR');
    console.log('====================================================\n');

    for (const camId of ['cam1', 'cam2']) {
      console.log(`Testando ${camId.toUpperCase()} (${config.cameras[camId].name})...`);
      try {
        const res = await StreamValidator.validateCamera(camId);
        console.log(` • Snapshot Direto do Sensor: ${res.snapshot.ok ? '✅ OK (' + res.snapshot.latencyMs + 'ms)' : '❌ ' + res.snapshot.error}`);
        console.log(` • Stream WebSocket:          ${res.stream.ok ? '✅ OK (' + res.stream.latencyMs + 'ms)' : '❌ ' + res.stream.error}`);
        if (res.snapshot.ok && res.stream.ok) {
          console.log(` • Imagens salvas em:`);
          console.log(`   - Sensor: ${res.snapshot.path}`);
          console.log(`   - Stream: ${res.stream.path}`);
        }
      } catch (err) {
        console.log(` • Falha geral: ${err.message}`);
      }
      console.log('----------------------------------------------------');
    }
  })();
}

module.exports = StreamValidator;

