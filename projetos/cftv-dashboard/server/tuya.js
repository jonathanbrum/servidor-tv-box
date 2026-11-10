const fs = require('fs');
const path = require('path');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

const CONFIG_PATH = path.join(__dirname, 'tuya-config.json');

const DEFAULT_CONFIG = {
  enabled: true,
  accessId: 'sf35a3ewrhwq4qdxv3yj',
  accessSecret: 'd41556a486b0477e8c3034fce803b969',
  baseUrl: 'https://openapi.tuyaus.com',
  homeId: '305545691',
  actionType: 'device', // 'device' ou 'scene'
  targetId: 'ebbb540edc733d06fbpbl6', // ID da Tomadinha como padrão
  targetName: 'Tomadinha',
  actionCommand: 'on', // 'on', 'toggle', 'off'
  sceneId: '',
  sceneName: ''
};

class TuyaService {
  constructor() {
    this.config = this.loadConfig();
    this.client = null;
    this.isInitialized = false;
    this.initClient();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.warn('[TuyaService] Falha ao carregar tuya-config.json:', err.message);
    }
    return { ...DEFAULT_CONFIG };
  }

  saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
      this.initClient();
      return { success: true, config: this.getPublicConfig() };
    } catch (err) {
      console.error('[TuyaService] Erro ao salvar configuração:', err.message);
      throw err;
    }
  }

  getPublicConfig() {
    return {
      enabled: Boolean(this.config.enabled),
      hasCredentials: Boolean(this.config.accessId && this.config.accessSecret),
      accessId: this.config.accessId ? `${this.config.accessId.slice(0, 6)}...` : '',
      baseUrl: this.config.baseUrl,
      homeId: this.config.homeId || '305545691',
      actionType: this.config.actionType || 'device',
      targetId: this.config.targetId || '',
      targetName: this.config.targetName || '',
      actionCommand: this.config.actionCommand || 'on',
      sceneId: this.config.sceneId || '',
      sceneName: this.config.sceneName || ''
    };
  }

  initClient() {
    if (!this.config.accessId || !this.config.accessSecret) {
      this.client = null;
      this.isInitialized = false;
      return;
    }

    try {
      this.client = new TuyaContext({
        baseUrl: this.config.baseUrl || 'https://openapi.tuyaus.com',
        accessKey: this.config.accessId.trim(),
        secretKey: this.config.accessSecret.trim()
      });
      this.isInitialized = false;
      console.log('[TuyaService] Cliente Tuya Cloud pronto para inicialização.');
    } catch (err) {
      console.error('[TuyaService] Erro ao configurar TuyaContext:', err.message);
      this.client = null;
    }
  }

  async ensureInit() {
    if (!this.client) throw new Error('Credenciais da Tuya não configuradas');
    if (!this.isInitialized) {
      await this.client.client.init();
      this.isInitialized = true;
    }
  }

  /**
   * Lista todos os dispositivos Smart Life vinculados à casa
   */
  async listDevices() {
    await this.ensureInit();
    const homeId = this.config.homeId || '305545691';

    try {
      const res = await this.client.request({
        path: `/v1.0/homes/${homeId}/devices`,
        method: 'GET'
      });

      if (res && res.success && Array.isArray(res.result)) {
        return res.result.map(d => {
          const switchStatus = d.status.find(s => s.code.startsWith('switch'));
          return {
            id: d.id,
            name: d.name,
            online: d.online,
            category: d.category,
            isOn: switchStatus ? Boolean(switchStatus.value) : false,
            switchCode: switchStatus ? switchStatus.code : 'switch_1'
          };
        });
      }
    } catch (err) {
      console.error('[TuyaService] Erro ao buscar dispositivos:', err.message);
    }
    return [];
  }

  /**
   * Lista todas as Cenas ("Executar ao clicar" / Tap-to-run) do app Smart Life
   */
  async listScenes() {
    await this.ensureInit();
    const homeId = this.config.homeId || '305545691';

    try {
      const res = await this.client.request({
        path: `/v1.0/homes/${homeId}/scenes`,
        method: 'GET'
      });

      if (res && res.success && Array.isArray(res.result)) {
        return res.result.map(s => ({
          id: s.scene_id,
          name: s.name,
          homeId: homeId
        }));
      }
    } catch (err) {
      console.warn('[TuyaService] Erro ao buscar cenas:', err.message);
    }
    return [];
  }

  /**
   * Envia comando para ligar/desligar um dispositivo Smart Life
   */
  async controlDevice(deviceId, powerOn = true, customCode = null) {
    await this.ensureInit();
    const targetId = deviceId || this.config.targetId;

    if (!targetId) throw new Error('Nenhum dispositivo selecionado');

    // Descobre o código de switch correto (switch_1 ou switch)
    let switchCode = customCode;
    if (!switchCode) {
      const devices = await this.listDevices();
      const dev = devices.find(d => d.id === targetId);
      switchCode = (dev && dev.switchCode) ? dev.switchCode : 'switch_1';
    }

    console.log(`[TuyaService ⚡] Enviando comando para ${targetId}: ${switchCode} = ${powerOn}`);

    const res = await this.client.request({
      path: `/v1.0/devices/${targetId}/commands`,
      method: 'POST',
      body: {
        commands: [
          {
            code: switchCode,
            value: Boolean(powerOn)
          }
        ]
      }
    });

    if (!res || !res.success) {
      throw new Error((res && res.msg) || 'Falha ao controlar dispositivo');
    }

    console.log(`[TuyaService ✅] Dispositivo acionado com sucesso!`);
    return { success: true, result: res.result };
  }

  /**
   * Aciona uma Cena do Smart Life
   */
  async triggerScene(targetSceneId = null) {
    await this.ensureInit();
    const sceneId = targetSceneId || this.config.sceneId;
    const homeId = this.config.homeId || '305545691';

    if (!sceneId) throw new Error('Nenhuma cena selecionada para disparo.');

    console.log(`[TuyaService ⚡] Disparando cena: ${sceneId}`);

    const res = await this.client.request({
      path: `/v1.0/homes/${homeId}/scenes/${sceneId}/trigger`,
      method: 'POST',
      body: {}
    });

    if (!res || !res.success) {
      throw new Error((res && res.msg) || 'Falha ao acionar cena');
    }

    console.log(`[TuyaService ✅] Cena disparada com sucesso!`);
    return { success: true, result: res.result };
  }

  /**
   * Faz o dispositivo piscar (ligar e desligar) X vezes em sequência
   */
  async blinkDevice(deviceId = null, times = 3, intervalMs = 700) {
    const targetId = deviceId || this.config.targetId;
    if (!targetId) throw new Error('Nenhum dispositivo selecionado para piscar');

    console.log(`[TuyaService 🚨] Piscando dispositivo ${targetId} ${times} vezes...`);
    for (let i = 1; i <= times; i++) {
      await this.controlDevice(targetId, true);
      await new Promise(r => setTimeout(r, intervalMs));
      await this.controlDevice(targetId, false);
      if (i < times) {
        await new Promise(r => setTimeout(r, intervalMs));
      }
    }
    console.log(`[TuyaService ✅] Sequência de ${times} piscadas finalizada.`);
    return { success: true, blinked: times };
  }

  /**
   * Disparo automático do alarme de IA (pode acionar dispositivo ou cena)
   */
  async triggerAlarm() {
    if (!this.config.enabled) return;

    if (this.config.actionType === 'scene' && this.config.sceneId) {
      return this.triggerScene(this.config.sceneId);
    } else if (this.config.targetId) {
      if (this.config.actionCommand === 'blink') {
        return this.blinkDevice(this.config.targetId, 3, 700);
      } else {
        return this.controlDevice(this.config.targetId, true);
      }
    }
  }
}

module.exports = new TuyaService();
