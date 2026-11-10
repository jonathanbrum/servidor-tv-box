const path = require('path');
const dotenv = require('dotenv');

// Carrega as variáveis do arquivo .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Codifica caracteres especiais para compor a URL RTSP com segurança.
 * Garante que caracteres como '*', '@', ':', '/', '#', '&' e espaços
 * não quebrem o parser de URL do ffmpeg / rtsp-relay.
 */
function encodeRtspComponent(str) {
  if (!str) return '';
  return encodeURIComponent(str)
    .replace(/\*/g, '%2A')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * Monta a URL RTSP padrão XMeye / Dahua compatível com base nos parâmetros da câmera.
 * @param {Object} cam Dados da câmera
 * @param {Object} [options] Opções adicionais (ex: subtype)
 */
function buildRtspUrl(cam, options = {}) {
  const user = encodeRtspComponent(cam.user);
  const pass = encodeRtspComponent(cam.pass);
  const auth = user ? (pass ? `${user}:${pass}@` : `${user}@`) : '';
  const port = cam.port || 554;
  const channel = cam.channel || 1;
  const subtype = options.subtype !== undefined ? options.subtype : (cam.subtype !== undefined ? cam.subtype : 0);

  // Formato padrão XMeye / Dahua: /cam/realmonitor?channel=1&subtype=0
  // subtype=0 -> Stream Principal (Full HD / 4MP)
  // subtype=1 -> Stream Secundário (Substream mais leve e rápido)
  return `rtsp://${auth}${cam.host}:${port}/cam/realmonitor?channel=${channel}&subtype=${subtype}`;
}

/**
 * Retorna uma versão mascarada da URL RTSP para logs e exibição pública sem expor a senha.
 */
function sanitizeRtspUrl(url) {
  if (!url) return '';
  return url.replace(/rtsp:\/\/([^:]+):([^@]+)@/, 'rtsp://$1:******@');
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3333,
  host: process.env.HOST || '0.0.0.0',
  cameras: {
    cam1: {
      id: 'cam1',
      name: process.env.CAM1_NAME || 'Fundos',
      host: process.env.CAM1_HOST || '192.168.1.150',
      port: parseInt(process.env.CAM1_PORT, 10) || 554,
      user: process.env.CAM1_USER || 'admin',
      pass: process.env.CAM1_PASS || '',
      channel: 1,
      subtype: 0,
      description: 'Roteador 1 - Rede Local Direta (Mesma sub-rede do PC)'
    },
    cam2: {
      id: 'cam2',
      name: process.env.CAM2_NAME || 'Entrada',
      host: process.env.CAM2_HOST || '192.168.0.102',
      port: parseInt(process.env.CAM2_PORT, 10) || 34567,
      user: process.env.CAM2_USER || 'admin',
      pass: process.env.CAM2_PASS || '',
      channel: 1,
      subtype: 0,
      description: 'Roteador 2 (Archer C50) - Port Forwarding via Claro WAN'
    }
  },
  buildRtspUrl,
  sanitizeRtspUrl,
  encodeRtspComponent
};

module.exports = config;
