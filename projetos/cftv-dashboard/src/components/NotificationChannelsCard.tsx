import { useEffect, useState } from 'react';
import { NotifyConfig } from '../types';
import { Icon } from './Icons';

interface NotificationChannelsCardProps {
  windowsNotify: boolean;
  onToggleWindowsNotify: (enabled: boolean) => void;
}

export function NotificationChannelsCard({
  windowsNotify,
  onToggleWindowsNotify,
}: NotificationChannelsCardProps) {
  const [cfg, setCfg] = useState<NotifyConfig | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [browserPerm, setBrowserPerm] = useState<string>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text });
    setTimeout(() => setFeedback(null), 5000);
  };

  useEffect(() => {
    fetch('/api/notify/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: NotifyConfig | null) => {
        if (data) setCfg(data);
      })
      .catch(() => {});
  }, []);

  const saveNotifyConfig = async (patch: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/notify/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.success && data.config) {
        setCfg(data.config);
        window.dispatchEvent(new CustomEvent('cftv-vigia-updated'));
        return true;
      }
    } catch {
      showFeedback(false, 'Erro ao salvar configuração de notificações.');
    }
    return false;
  };

  const handleToggleBrowserNotify = async () => {
    const next = !windowsNotify;
    if (next && 'Notification' in window) {
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        setBrowserPerm(perm);
        if (perm !== 'granted') {
          showFeedback(false, 'Permissão negada no navegador. Libere as notificações no cadeado da barra de URL.');
          return;
        }
      } else {
        setBrowserPerm(Notification.permission);
      }
    }
    onToggleWindowsNotify(next);
  };

  const handleTestBrowserNotify = async () => {
    if (!('Notification' in window)) {
      showFeedback(false, 'Este navegador não suporta notificações Web.');
      return;
    }
    let perm = Notification.permission;
    if (perm === 'default') {
      perm = await Notification.requestPermission();
      setBrowserPerm(perm);
    }
    if (perm !== 'granted') {
      showFeedback(false, 'Notificações bloqueadas neste navegador (ative no ícone do cadeado da URL).');
      return;
    }
    try {
      new Notification('🚨 [TESTE] Vigia IA — Pessoa detectada', {
        body: 'CAM 2 (Entrada) • Notificação no Windows funcionando!',
        icon: `/api/ia/snapshot/cam2?t=${Date.now()}`,
        tag: 'cftv-test-notify',
      });
      showFeedback(true, 'Notificação enviada ao navegador / Windows!');
    } catch (err: any) {
      showFeedback(false, err?.message || 'Falha ao disparar notificação no navegador.');
    }
  };

  const handleTestServerChannel = async (channel: 'windows-toast' | 'ntfy' | 'telegram') => {
    setTestingChannel(channel);
    try {
      if (channel === 'telegram' && tokenInput.trim()) {
        await saveNotifyConfig({ telegramBotToken: tokenInput.trim() });
        setTokenInput('');
      }
      const res = await fetch('/api/notify/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, camId: 'cam2' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const label =
          channel === 'windows-toast'
            ? 'Toast nativo do Windows enviado!'
            : channel === 'ntfy'
              ? 'Push ntfy enviado com sucesso!'
              : 'Mensagem enviada no Telegram!';
        showFeedback(true, label);
      } else {
        showFeedback(false, data.error || 'Falha ao testar canal.');
      }
    } catch {
      showFeedback(false, 'Sem resposta do servidor ao testar notificação.');
    } finally {
      setTestingChannel(null);
    }
  };

  const handleGenerateTopic = () => {
    const rand = Math.random().toString(36).slice(2, 8);
    const topic = `cftv-vigia-${rand}`;
    if (cfg) setCfg({ ...cfg, ntfyTopic: topic });
    saveNotifyConfig({ ntfyTopic: topic });
  };

  const activeCount =
    (windowsNotify ? 1 : 0) +
    (cfg?.windowsToastEnabled ? 1 : 0) +
    (cfg?.ntfyEnabled ? 1 : 0) +
    (cfg?.telegramEnabled ? 1 : 0);

  return (
    <div className="pt-3 border-t border-[#252c30]">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
          <Icon name="bell" size={14} className="text-lime-400" /> Notificações (Windows &amp; Android)
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
            activeCount > 0
              ? 'bg-lime-400/15 text-lime-400 border border-lime-400/30'
              : 'bg-neutral-800 text-neutral-400'
          }`}
        >
          {activeCount > 0 ? `${activeCount} ATIVO(S)` : 'DESATIVADO'}
        </span>
      </div>

      <div className="space-y-2.5 bg-[#121719] p-2.5 rounded-lg border border-[#252c30] text-xs">
        {/* Intervalo mínimo (Cooldown) entre notificações */}
        <div className="p-2 rounded bg-[#0c1012] border border-[#20272b] space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-neutral-300 font-medium">⏱️ Intervalo mínimo entre alertas</span>
            <span className="text-lime-400 font-mono font-bold">
              {!cfg || cfg.cooldownSeconds === 0
                ? 'Sem pausa'
                : cfg.cooldownSeconds < 60
                  ? `${cfg.cooldownSeconds}s`
                  : `${Math.round(cfg.cooldownSeconds / 60)}m`}
            </span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 text-[10px]">
            {[
              { label: '15s', val: 15 },
              { label: '30s', val: 30 },
              { label: '1m', val: 60 },
              { label: '3m', val: 180 },
              { label: '5m', val: 300 },
              { label: '15m', val: 900 },
              { label: '0s', val: 0 },
            ].map((item) => {
              const currentCooldown = cfg?.cooldownSeconds ?? 60;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    if (cfg) setCfg({ ...cfg, cooldownSeconds: item.val });
                    saveNotifyConfig({ cooldownSeconds: item.val });
                  }}
                  title={
                    item.val === 0
                      ? 'Sem limite (notifica a cada detecção)'
                      : `Aguardar ${item.label} antes de notificar novamente`
                  }
                  className={`py-1 px-1 rounded text-center transition-colors font-mono ${
                    currentCooldown === item.val
                      ? 'bg-lime-400 text-black font-bold shadow-sm'
                      : 'bg-[#1b2226] text-neutral-300 hover:bg-[#252f35]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-neutral-500 leading-tight">
            Evita alertas repetidos se a mesma pessoa/carro continuar na cerca.
          </p>
        </div>

        {/* 1. Notificação no Navegador / Windows */}
        <div className="p-2 rounded bg-[#0c1012] border border-[#20272b] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-neutral-200 text-[11px]">
                💻 Windows / Navegador (Aba Aberta)
              </div>
              <div className="text-[10px] text-neutral-400">
                {browserPerm === 'granted'
                  ? 'Permissão concedida no navegador'
                  : browserPerm === 'denied'
                    ? 'Bloqueado no navegador (libere na barra de URL)'
                    : 'Solicita permissão ao ativar'}
              </div>
            </div>
            <button
              type="button"
              className={`switch shrink-0 ${windowsNotify ? 'on' : ''}`}
              onClick={handleToggleBrowserNotify}
              title="Ativar/desativar notificação do navegador"
            >
              <i />
            </button>
          </div>
          {windowsNotify && (
            <button
              type="button"
              onClick={handleTestBrowserNotify}
              className="w-full py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-medium border border-neutral-700 transition-colors"
            >
              🔔 Testar Notificação no Navegador
            </button>
          )}
        </div>

        {/* 2. Windows Toast Nativo (sem precisar de navegador aberto) */}
        {cfg?.windowsToastSupported && (
          <div className="p-2 rounded bg-[#0c1012] border border-[#20272b] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-neutral-200 text-[11px]">
                  🪟 Windows Toast (Sem Navegador)
                </div>
                <div className="text-[10px] text-neutral-400">
                  Notifica no Windows mesmo com a aba fechada
                </div>
              </div>
              <button
                type="button"
                className={`switch shrink-0 ${cfg.windowsToastEnabled ? 'on' : ''}`}
                onClick={() => {
                  const next = !cfg.windowsToastEnabled;
                  setCfg({ ...cfg, windowsToastEnabled: next });
                  saveNotifyConfig({ windowsToastEnabled: next });
                }}
              >
                <i />
              </button>
            </div>
            {cfg.windowsToastEnabled && (
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfg.windowsToastAttachPhoto}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setCfg({ ...cfg, windowsToastAttachPhoto: val });
                      saveNotifyConfig({ windowsToastAttachPhoto: val });
                    }}
                    className="accent-lime-400"
                  />
                  Anexar foto da câmera no Toast
                </label>
                <button
                  type="button"
                  disabled={testingChannel === 'windows-toast'}
                  onClick={() => handleTestServerChannel('windows-toast')}
                  className="w-full py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-medium border border-neutral-700 transition-colors"
                >
                  {testingChannel === 'windows-toast' ? 'Enviando...' : '🪟 Testar Toast do Windows'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 3. Push Android / PC via ntfy.sh */}
        <div className="p-2 rounded bg-[#0c1012] border border-[#20272b] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-neutral-200 text-[11px]">
                📱 Push Android &amp; PC (ntfy.sh)
              </div>
              <div className="text-[10px] text-neutral-400">
                Receba no celular com foto, mesmo fora de casa
              </div>
            </div>
            <button
              type="button"
              className={`switch shrink-0 ${cfg?.ntfyEnabled ? 'on' : ''}`}
              onClick={() => {
                if (!cfg) return;
                const next = !cfg.ntfyEnabled;
                setCfg({ ...cfg, ntfyEnabled: next });
                saveNotifyConfig({ ntfyEnabled: next });
              }}
            >
              <i />
            </button>
          </div>

          {cfg?.ntfyEnabled && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                <span>Tópico secreto (canal):</span>
                <button
                  type="button"
                  onClick={handleGenerateTopic}
                  className="text-lime-400 hover:underline"
                >
                  🎲 Gerar tópico
                </button>
              </div>
              <input
                type="text"
                value={cfg.ntfyTopic}
                onChange={(e) => setCfg({ ...cfg, ntfyTopic: e.target.value })}
                onBlur={() => saveNotifyConfig({ ntfyTopic: cfg.ntfyTopic })}
                placeholder="ex: cftv-portao-9f3a"
                className="w-full px-2 py-1 bg-[#080b0d] border border-[#2c3539] rounded text-neutral-200 font-mono text-[11px] focus:border-lime-400 focus:outline-none"
              />
              <input
                type="url"
                value={cfg.ntfyServer}
                onChange={(e) => setCfg({ ...cfg, ntfyServer: e.target.value })}
                onBlur={() => saveNotifyConfig({ ntfyServer: cfg.ntfyServer })}
                placeholder="https://ntfy.sh"
                className="w-full px-2 py-1 bg-[#080b0d] border border-[#2c3539] rounded text-neutral-400 font-mono text-[10px] focus:border-lime-400 focus:outline-none"
              />
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.ntfyAttachPhoto}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setCfg({ ...cfg, ntfyAttachPhoto: val });
                    saveNotifyConfig({ ntfyAttachPhoto: val });
                  }}
                  className="accent-lime-400"
                />
                Enviar foto da câmera no alerta
              </label>
              <p className="text-[10px] text-neutral-500 leading-tight">
                No Android, instale o app <b>ntfy</b> (grátis, sem login) e inscreva-se no tópico acima.
              </p>
              <button
                type="button"
                disabled={testingChannel === 'ntfy'}
                onClick={async () => {
                  await saveNotifyConfig({
                    ntfyTopic: cfg.ntfyTopic,
                    ntfyServer: cfg.ntfyServer,
                  });
                  handleTestServerChannel('ntfy');
                }}
                className="w-full py-1 rounded bg-lime-400/15 hover:bg-lime-400/25 text-lime-400 text-[11px] font-semibold border border-lime-400/30 transition-colors"
              >
                {testingChannel === 'ntfy' ? 'Enviando...' : '📱 Testar Push no ntfy'}
              </button>
            </div>
          )}
        </div>

        {/* 4. Bot do Telegram (Android & Windows) */}
        <div className="p-2 rounded bg-[#0c1012] border border-[#20272b] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-neutral-200 text-[11px]">
                ✈️ Telegram Bot (Android &amp; PC)
              </div>
              <div className="text-[10px] text-neutral-400">
                Envia alerta com foto direto no Telegram
              </div>
            </div>
            <button
              type="button"
              className={`switch shrink-0 ${cfg?.telegramEnabled ? 'on' : ''}`}
              onClick={() => {
                if (!cfg) return;
                const next = !cfg.telegramEnabled;
                setCfg({ ...cfg, telegramEnabled: next });
                saveNotifyConfig({ telegramEnabled: next });
              }}
            >
              <i />
            </button>
          </div>

          {cfg?.telegramEnabled && (
            <div className="space-y-1.5 pt-1">
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onBlur={() => {
                  if (tokenInput.trim()) {
                    saveNotifyConfig({ telegramBotToken: tokenInput.trim() });
                    setTokenInput('');
                  }
                }}
                placeholder={
                  cfg.hasTelegramToken
                    ? `Token salvo (${cfg.telegramBotTokenMasked})`
                    : 'Bot Token (@BotFather)'
                }
                className="w-full px-2 py-1 bg-[#080b0d] border border-[#2c3539] rounded text-neutral-200 font-mono text-[11px] focus:border-lime-400 focus:outline-none"
              />
              <input
                type="text"
                value={cfg.telegramChatId}
                onChange={(e) => setCfg({ ...cfg, telegramChatId: e.target.value })}
                onBlur={() => saveNotifyConfig({ telegramChatId: cfg.telegramChatId })}
                placeholder="Chat ID (ex: 123456789)"
                className="w-full px-2 py-1 bg-[#080b0d] border border-[#2c3539] rounded text-neutral-200 font-mono text-[11px] focus:border-lime-400 focus:outline-none"
              />
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.telegramAttachPhoto}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setCfg({ ...cfg, telegramAttachPhoto: val });
                    saveNotifyConfig({ telegramAttachPhoto: val });
                  }}
                  className="accent-lime-400"
                />
                Enviar foto da câmera no Telegram
              </label>
              <button
                type="button"
                disabled={testingChannel === 'telegram'}
                onClick={async () => {
                  await saveNotifyConfig({ telegramChatId: cfg.telegramChatId });
                  handleTestServerChannel('telegram');
                }}
                className="w-full py-1 rounded bg-lime-400/15 hover:bg-lime-400/25 text-lime-400 text-[11px] font-semibold border border-lime-400/30 transition-colors"
              >
                {testingChannel === 'telegram' ? 'Enviando...' : '✈️ Testar Telegram'}
              </button>
            </div>
          )}
        </div>

        {feedback && (
          <p
            className={`text-[11px] text-center font-mono pt-0.5 ${
              feedback.ok ? 'text-lime-400' : 'text-amber-400'
            }`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    </div>
  );
}
