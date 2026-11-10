const net = require('net');
const os = require('os');
const XMeyeClient = require('./xmeye-client');
const config = require('./config');

/**
 * Utilitário de Busca e Descoberta Automática de Câmeras XMeye / Sofia na Rede Local
 */
class CameraScanner {
  /**
   * Testa se uma porta TCP está aberta em um determinado host.
   */
  static testPort(host, port = 34567, timeout = 1000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });
  }

  /**
   * Identifica as sub-redes IPv4 locais relevantes para varredura.
   */
  static getSubnetsToScan() {
    const subnets = new Set(['192.168.1', '192.168.0']);
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
          }
        }
      }
    }
    return Array.from(subnets);
  }

  /**
   * Realiza varredura assíncrona rápida de uma faixa /24 em lotes paralelos.
   */
  static async scanSubnet(subnetPrefix, port = 34567, concurrency = 40) {
    const foundIps = [];
    const ips = [];
    for (let i = 1; i <= 254; i++) {
      ips.push(`${subnetPrefix}.${i}`);
    }

    for (let i = 0; i < ips.length; i += concurrency) {
      const batch = ips.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(ip => CameraScanner.testPort(ip, port, 1000).then(open => open ? ip : null))
      );
      for (const ip of results) {
        if (ip) foundIps.push(ip);
      }
    }
    return foundIps;
  }

  /**
   * Consulta os metadados do dispositivo via protocolo Sofia (MsgId 1020 / SystemInfo).
   */
  static async getDeviceInfo(host, port = 34567, user = 'admin', pass = '2275951Jon*') {
    return new Promise((resolve) => {
      const client = new net.Socket();
      let sessionId = 0;

      const timer = setTimeout(() => {
        client.destroy();
        resolve({ host, port, error: 'Tempo limite na identificação' });
      }, 2500);

      client.connect(port, host, () => {
        const loginPkt = XMeyeClient.createPacket(1000, 0, {
          EncryptType: 'NONE',
          LoginType: 'DVRIP-Web',
          PassWord: pass || '',
          UserName: user || 'admin'
        });
        client.write(loginPkt);
      });

      client.on('data', (buf) => {
        if (buf.length >= 20) {
          const msgId = buf.readUInt16LE(14);
          if (msgId === 1001) {
            try {
              const jsonStr = buf.slice(20).toString('utf8').replace(/\0/g, '').trim();
              const data = JSON.parse(jsonStr);
              if (data.Ret === 100) {
                sessionId = data.SessionID;
                const reqPkt = XMeyeClient.createPacket(1020, sessionId, { Name: 'SystemInfo' });
                client.write(reqPkt);
              } else {
                clearTimeout(timer);
                client.destroy();
                resolve({ host, port, error: `Senha incorreta (Ret: ${data.Ret})` });
              }
            } catch (e) {
              clearTimeout(timer);
              client.destroy();
              resolve({ host, port, error: e.message });
            }
          } else if (msgId === 1021) {
            clearTimeout(timer);
            client.destroy();
            try {
              const jsonStr = buf.slice(20).toString('utf8').replace(/\0/g, '').trim();
              const info = JSON.parse(jsonStr);
              resolve({
                host,
                port,
                online: true,
                systemInfo: info.SystemInfo || {}
              });
            } catch (e) {
              resolve({ host, port, online: true, raw: buf.slice(20).toString() });
            }
          }
        }
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        client.destroy();
        resolve({ host, port, error: err.message });
      });
    });
  }

  /**
   * Executa varredura completa em todas as sub-redes detectadas.
   */
  static async scanAll(port = 34567) {
    const subnets = CameraScanner.getSubnetsToScan();
    const discovered = [];

    for (const subnet of subnets) {
      const openIps = await CameraScanner.scanSubnet(subnet, port);
      for (const ip of openIps) {
        const info = await CameraScanner.getDeviceInfo(ip, port);
        discovered.push(info);
      }
    }
    return discovered;
  }
}

// Execução direta via CLI (npm run scan ou node server/scanner.js)
if (require.main === module) {
  (async () => {
    console.log('====================================================');
    console.log('  🔍 BUSCADOR DE CÂMERAS CFTV XMEYE / SOFIA NA REDE');
    console.log('====================================================');

    const subnets = CameraScanner.getSubnetsToScan();
    console.log(`Sub-redes para varredura: ${subnets.map(s => s + '.x').join(', ')}\n`);

    console.log('Varrendo dispositivos na porta 34567...');
    const startTime = Date.now();
    const results = await CameraScanner.scanAll(34567);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\nBusca concluída em ${duration}s! Encontrados: ${results.length} dispositivo(s)\n`);

    results.forEach((dev, idx) => {
      console.log(`[Dispositivo #${idx + 1}]`);
      console.log(` • IP:Porta:    ${dev.host}:${dev.port}`);
      if (dev.online && dev.systemInfo) {
        console.log(` • Modelo:      ${dev.systemInfo.DeviceModel || 'Desconhecido'}`);
        console.log(` • Hardware:    ${dev.systemInfo.HardWare || 'N/A'}`);
        console.log(` • Serial:      ${dev.systemInfo.SerialNo || 'N/A'}`);
        console.log(` • Firmware:    ${dev.systemInfo.SoftWareVersion || 'N/A'}`);
      } else {
        console.log(` • Status:      ${dev.error || 'Indisponível'}`);
      }
      console.log('----------------------------------------------------');
    });

    console.log('\nStatus das câmeras configuradas no .env atual:');
    console.log(` • Câmera 1 (Fundos):  ${config.cameras.cam1.host}:${config.cameras.cam1.port}`);
    console.log(` • Câmera 2 (Entrada): ${config.cameras.cam2.host}:${config.cameras.cam2.port}`);

    const cam2Online = results.some(r => r.host === config.cameras.cam2.host);
    if (!cam2Online) {
      console.log('\n⚠️  ATENÇÃO: A Câmera 2 (Entrada) não respondeu na porta 34567.');
      console.log('   Verifique se:');
      console.log('   1. O roteador TP-Link Archer C50 (da frente) está ligado na tomada.');
      console.log('   2. O cabo entre o roteador da frente e o modem da Claro está conectado.');
      console.log('   3. A regra de Port Forwarding (porta 34567) ainda está ativa no painel do Archer C50.');
    }
  })();
}

module.exports = CameraScanner;

