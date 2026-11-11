const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'notify-config.json');

const DEFAULT_CONFIG = {
  cooldownSeconds: 60,
  windowsToastEnabled: false,
  windowsToastAttachPhoto: true,
  ntfyEnabled: false,
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: '',
  ntfyAttachPhoto: true,
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  telegramAttachPhoto: true
};

const TARGET_LABELS = {
  person: 'Pessoa',
  car: 'Carro',
  motorcycle: 'Moto',
  dog: 'Animal',
  cat: 'Animal',
  animal: 'Animal'
};

/**
 * Formata um evento de alerta em título e mensagem legíveis.
 */
function formatAlertText(alertData) {
  const camLabel = alertData.camId === 'cam1' ? 'CAM 1 (Fundos)' : 'CAM 2 (Entrada)';
  const targetLabel = TARGET_LABELS[alertData.targetClass] || alertData.targetClass || 'Movimento';
  const duration = alertData.duration ? `${alertData.duration}s` : 'detectado';
  const timeStr = new Date(alertData.timestamp || Date.now()).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return {
    camLabel,
    targetLabel,
    title: `Vigia IA: ${targetLabel} em ${camLabel}`,
    message: `${targetLabel} na cerca virtual (${duration}) • ${timeStr}`
  };
}

/**
 * Serviço de notificações multiplataforma (Windows Toast, ntfy Android/PC, Telegram).
 */
class NotifierService {
  constructor() {
    this.config = this.loadConfig();
    this.lastDispatchByCam = new Map();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return { ...DEFAULT_CONFIG, ...raw };
      }
    } catch (err) {
      console.warn('[Notifier] Falha ao ler notify-config.json:', err.message);
    }
    return { ...DEFAULT_CONFIG };
  }

  saveConfig(newConfig = {}) {
    const merged = { ...this.config };

    if (newConfig.cooldownSeconds !== undefined) {
      const secs = Number(newConfig.cooldownSeconds);
      if (Number.isFinite(secs) && secs >= 0 && secs <= 3600) {
        merged.cooldownSeconds = Math.round(secs);
      }
    }

    const boolFields = [
      'windowsToastEnabled',
      'windowsToastAttachPhoto',
      'ntfyEnabled',
      'ntfyAttachPhoto',
      'telegramEnabled',
      'telegramAttachPhoto'
    ];
    for (const key of boolFields) {
      if (typeof newConfig[key] === 'boolean') {
        merged[key] = newConfig[key];
      }
    }

    if (typeof newConfig.ntfyServer === 'string') {
      merged.ntfyServer = newConfig.ntfyServer.trim().replace(/\/+$/, '') || 'https://ntfy.sh';
    }
    if (typeof newConfig.ntfyTopic === 'string') {
      merged.ntfyTopic = newConfig.ntfyTopic.trim();
    }
    if (typeof newConfig.telegramChatId === 'string') {
      merged.telegramChatId = newConfig.telegramChatId.trim();
    }
    if (typeof newConfig.telegramBotToken === 'string') {
      const token = newConfig.telegramBotToken.trim();
      // Preserva token existente caso a UI envie a máscara exibida
      if (!token.includes('...')) {
        merged.telegramBotToken = token;
      }
    }

    this.config = merged;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
    return { success: true, config: this.getPublicConfig() };
  }

  getPublicConfig() {
    const token = this.config.telegramBotToken || '';
    const maskedToken = token.length > 10
      ? `${token.slice(0, 6)}...${token.slice(-4)}`
      : (token ? '••••••' : '');

    return {
      platform: process.platform,
      cooldownSeconds: Number(this.config.cooldownSeconds ?? 60),
      windowsToastSupported: process.platform === 'win32',
      windowsToastEnabled: Boolean(this.config.windowsToastEnabled),
      windowsToastAttachPhoto: Boolean(this.config.windowsToastAttachPhoto),
      ntfyEnabled: Boolean(this.config.ntfyEnabled),
      ntfyServer: this.config.ntfyServer || 'https://ntfy.sh',
      ntfyTopic: this.config.ntfyTopic || '',
      ntfyAttachPhoto: Boolean(this.config.ntfyAttachPhoto),
      telegramEnabled: Boolean(this.config.telegramEnabled),
      hasTelegramToken: Boolean(token),
      telegramBotTokenMasked: maskedToken,
      telegramChatId: this.config.telegramChatId || '',
      telegramAttachPhoto: Boolean(this.config.telegramAttachPhoto)
    };
  }

  /**
   * Dispara notificação nativa Toast no Windows 10/11 (funciona mesmo sem navegador aberto).
   */
  sendWindowsToast({ title, message, imageBuffer }) {
    if (process.platform !== 'win32') {
      return Promise.resolve({ ok: false, skipped: true, error: 'Disponível apenas no Windows' });
    }

    return new Promise((resolve) => {
      let tempImgPath = '';
      if (imageBuffer && this.config.windowsToastAttachPhoto) {
        try {
          tempImgPath = path.join(os.tmpdir(), `cftv-alert-${Date.now()}.jpg`);
          fs.writeFileSync(tempImgPath, imageBuffer);
        } catch (err) {
          tempImgPath = '';
        }
      }

      const psScript = `
        $ErrorActionPreference = 'Stop'
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
        $escTitle = [System.Security.SecurityElement]::Escape($env:CFTV_TOAST_TITLE)
        $escBody = [System.Security.SecurityElement]::Escape($env:CFTV_TOAST_BODY)
        $imgNode = ''
        if ($env:CFTV_TOAST_IMG -and (Test-Path $env:CFTV_TOAST_IMG)) {
          $uri = [System.Security.SecurityElement]::Escape(([System.Uri]$env:CFTV_TOAST_IMG).AbsoluteUri)
          $imgNode = "<image placement='hero' src='$uri'/>"
        }
        $xmlString = "<toast duration='long'><visual><binding template='ToastGeneric'><text>$escTitle</text><text>$escBody</text>$imgNode</binding></visual></toast>"
        $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
        $doc.LoadXml($xmlString)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
      `;

      const child = spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
        {
          windowsHide: true,
          env: {
            ...process.env,
            CFTV_TOAST_TITLE: title,
            CFTV_TOAST_BODY: message,
            CFTV_TOAST_IMG: tempImgPath
          }
        }
      );

      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const cleanupTemp = () => {
        if (tempImgPath) {
          setTimeout(() => {
            fs.unlink(tempImgPath, () => {});
          }, 15000);
        }
      };

      child.on('close', (code) => {
        cleanupTemp();
        if (code === 0) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: stderr.trim() || `PowerShell exited with ${code}` });
        }
      });

      child.on('error', (err) => {
        cleanupTemp();
        resolve({ ok: false, error: err.message });
      });
    });
  }

  /**
   * Envia push pelo ntfy.sh (Android/iOS/Windows) com foto anexada opcional.
   */
  async sendNtfy({ title, message, imageBuffer }) {
    const topic = (this.config.ntfyTopic || '').trim();
    if (!topic) {
      return { ok: false, error: 'Tópico ntfy não configurado' };
    }

    const base = (this.config.ntfyServer || 'https://ntfy.sh').replace(/\/+$/, '');
    const attachPhoto = Boolean(this.config.ntfyAttachPhoto && imageBuffer);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      let url = `${base}/${encodeURIComponent(topic)}`;
      const headers = {
        Priority: 'high',
        Tags: 'rotating_light,camera'
      };
      let body;

      if (attachPhoto) {
        const params = new URLSearchParams({
          title,
          message,
          priority: 'high',
          tags: 'rotating_light,camera',
          filename: `cftv-${Date.now()}.jpg`
        });
        url = `${url}?${params.toString()}`;
        headers['Content-Type'] = 'image/jpeg';
        body = imageBuffer;
      } else {
        headers['Title'] = title;
        headers['Content-Type'] = 'text/plain; charset=utf-8';
        body = message;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 120) || res.statusText}` };
      }
      return { ok: true };
    } catch (err) {
      clearTimeout(timeoutId);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Envia alerta para Telegram (sendPhoto quando houver snapshot, ou sendMessage).
   */
  async sendTelegram({ title, message, imageBuffer }) {
    const token = (this.config.telegramBotToken || '').trim();
    const chatId = (this.config.telegramChatId || '').trim();
    if (!token || !chatId) {
      return { ok: false, error: 'Token do Bot ou Chat ID não configurados' };
    }

    const caption = `🚨 ${title}\n${message}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    try {
      let res;
      if (this.config.telegramAttachPhoto && imageBuffer) {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('caption', caption);
        form.append('photo', new Blob([imageBuffer], { type: 'image/jpeg' }), `cftv-${Date.now()}.jpg`);

        res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          body: form,
          signal: controller.signal
        });
      } else {
        res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: caption }),
          signal: controller.signal
        });
      }
      clearTimeout(timeoutId);

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        return { ok: false, error: data.description || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      clearTimeout(timeoutId);
      return { ok: false, error: err.message };
    }
  }

  async resolveSnapshotIfNeeded(needsPhoto, getSnapshot) {
    if (!needsPhoto || typeof getSnapshot !== 'function') return null;
    try {
      return await getSnapshot();
    } catch (err) {
      console.warn('[Notifier] Falha ao capturar foto para notificação:', err.message);
      return null;
    }
  }

  /**
   * Dispara todos os canais habilitados para um alerta real do Vigia IA, respeitando o intervalo mínimo.
   */
  async dispatchAlert(alertData, { getSnapshot, force = false } = {}) {
    const useWinToast = Boolean(this.config.windowsToastEnabled && process.platform === 'win32');
    const useNtfy = Boolean(this.config.ntfyEnabled && this.config.ntfyTopic);
    const useTelegram = Boolean(
      this.config.telegramEnabled && this.config.telegramBotToken && this.config.telegramChatId
    );

    if (!useWinToast && !useNtfy && !useTelegram) {
      return {};
    }

    const camKey = alertData.camId || 'cam2';
    const cooldownMs = Math.max(0, Number(this.config.cooldownSeconds ?? 60)) * 1000;
    const lastSentAt = this.lastDispatchByCam.get(camKey) || 0;
    const elapsedMs = Date.now() - lastSentAt;

    if (!force && cooldownMs > 0 && elapsedMs < cooldownMs) {
      const retryInSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
      return { throttled: true, retryInSeconds };
    }
    this.lastDispatchByCam.set(camKey, Date.now());

    const needsPhoto =
      (useWinToast && this.config.windowsToastAttachPhoto) ||
      (useNtfy && this.config.ntfyAttachPhoto) ||
      (useTelegram && this.config.telegramAttachPhoto);

    const imageBuffer = await this.resolveSnapshotIfNeeded(needsPhoto, getSnapshot);
    const { title, message } = formatAlertText(alertData);

    const jobs = {};
    if (useWinToast) {
      jobs.windowsToast = this.sendWindowsToast({ title, message, imageBuffer });
    }
    if (useNtfy) {
      jobs.ntfy = this.sendNtfy({ title, message, imageBuffer });
    }
    if (useTelegram) {
      jobs.telegram = this.sendTelegram({ title, message, imageBuffer });
    }

    const keys = Object.keys(jobs);
    const settled = await Promise.all(keys.map((k) => jobs[k]));
    const results = {};
    keys.forEach((k, idx) => {
      results[k] = settled[idx];
      if (!settled[idx].ok && !settled[idx].skipped) {
        console.warn(`[Notifier -> ${k}] Falha:`, settled[idx].error);
      }
    });
    return results;
  }

  /**
   * Dispara teste manual de um canal específico ('windows-toast' | 'ntfy' | 'telegram').
   */
  async testChannel(channel, { getSnapshot } = {}) {
    const sampleAlert = {
      camId: 'cam2',
      targetClass: 'person',
      duration: 5,
      timestamp: new Date().toISOString()
    };
    const { title, message } = formatAlertText(sampleAlert);
    const testTitle = `[TESTE] ${title}`;

    if (channel === 'windows-toast') {
      const imageBuffer = await this.resolveSnapshotIfNeeded(this.config.windowsToastAttachPhoto, getSnapshot);
      return this.sendWindowsToast({ title: testTitle, message, imageBuffer });
    }
    if (channel === 'ntfy') {
      const imageBuffer = await this.resolveSnapshotIfNeeded(this.config.ntfyAttachPhoto, getSnapshot);
      return this.sendNtfy({ title: testTitle, message, imageBuffer });
    }
    if (channel === 'telegram') {
      const imageBuffer = await this.resolveSnapshotIfNeeded(this.config.telegramAttachPhoto, getSnapshot);
      return this.sendTelegram({ title: testTitle, message, imageBuffer });
    }
    return { ok: false, error: 'Canal desconhecido' };
  }
}

module.exports = new NotifierService();
