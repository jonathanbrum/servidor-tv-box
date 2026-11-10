const path = require('path');
const fs = require('fs');

/**
 * Resolve o caminho do binário FFmpeg de forma universal:
 * 1. Variável de ambiente FFMPEG_PATH (ex.: Docker Alpine ou Linux customizado)
 * 2. Módulo ffmpeg-static (se instalado e arquivo existir)
 * 3. Caminho local do node_modules no Windows
 * 4. 'ffmpeg' nativo do sistema operacional ($PATH)
 */
function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) {
      return staticPath;
    }
  } catch (err) {}

  const localWin = path.resolve(__dirname, '../node_modules/ffmpeg-static/ffmpeg.exe');
  if (process.platform === 'win32' && fs.existsSync(localWin)) {
    return localWin;
  }

  return 'ffmpeg';
}

module.exports = resolveFfmpegPath();
