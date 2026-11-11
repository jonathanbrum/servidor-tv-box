import { useEffect, useRef, useState } from 'react';
import { Icon } from './components/Icons';
import { LiveView } from './views/LiveView';
import { WallView } from './views/WallView';
import { TVMode } from './views/TVMode';
import { AIView } from './views/AIView';
import { RecordView } from './views/RecordView';
import { NetworkView } from './views/NetworkView';
import { SettingsModal } from './components/SettingsModal';
import { useVigiaMonitor } from './hooks/useVigiaMonitor';
import { CameraInfo, IconName, SystemStatus } from './types';

const nav = [
  { id: 'live', label: 'Monitoramento', icon: 'grid' as IconName },
  { id: 'wall', label: 'Modo TV', icon: 'wall' as IconName },
  { id: 'ai', label: 'Vigia IA', icon: 'ai' as IconName },
  { id: 'record', label: 'Gravações', icon: 'record' as IconName },
  { id: 'network', label: 'Diagnóstico', icon: 'network' as IconName },
] as const;

export default function App() {
  const [page, setPage] = useState<string>('live');
  const [mobileNav, setMobileNav] = useState(false);
  const [time, setTime] = useState(new Date());
  const [tvMode, setTvMode] = useState(() => window.location.hash === '#tv');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Sistema de Notificações Real
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<{ id: string; text: string; time: string; read: boolean }>>([]);

  // Dados reais vindo da API do servidor
  const [cameras, setCameras] = useState<Record<string, CameraInfo>>({
    cam1: {
      id: 'cam1',
      name: 'Fundos',
      host: '192.168.1.134',
      port: 554,
    },
    cam2: {
      id: 'cam2',
      name: 'Entrada',
      host: '192.168.0.102',
      port: 554,
    },
  });
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    cam1: { connected: true, lastCheck: '', latency: 42, clients: 0 },
    cam2: { connected: true, lastCheck: '', latency: 28, clients: 0 },
  });
  const [primaryIp, setPrimaryIp] = useState('192.168.1.134');

  // Monitoramento ao vivo do Modo Vigia + flag de notificação no navegador/Windows
  const { windowsNotify, notifyCooldownSeconds } = useVigiaMonitor();
  const camerasRef = useRef(cameras);
  const windowsNotifyRef = useRef(windowsNotify);
  const notifyCooldownRef = useRef(notifyCooldownSeconds);
  const lastWinNotifyAtRef = useRef(0);

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  useEffect(() => {
    windowsNotifyRef.current = windowsNotify;
  }, [windowsNotify]);

  useEffect(() => {
    notifyCooldownRef.current = notifyCooldownSeconds;
  }, [notifyCooldownSeconds]);

  // Relógio do cabeçalho
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Monitora alterações na URL para ativar/desativar modo TV
  useEffect(() => {
    const syncTvRoute = () => setTvMode(window.location.hash === '#tv');
    window.addEventListener('hashchange', syncTvRoute);
    return () => window.removeEventListener('hashchange', syncTvRoute);
  }, []);

  // Escuta alertas reais via SSE para gerar notificações no sininho e no Windows/Navegador
  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/ia/events');
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'alarm') {
            const targetLabels: Record<string, string> = {
              person: 'Pessoa detectada',
              car: 'Veículo detectado',
              motorcycle: 'Moto detectada',
              animal: 'Animal detectado',
            };
            const target = targetLabels[data.targetClass] || 'Movimento na cerca';
            const camKey = data.camId === 'cam1' ? 'cam1' : 'cam2';
            const camCode = camKey === 'cam1' ? 'CAM 1' : 'CAM 2';
            const camName = camerasRef.current[camKey]?.name || (camKey === 'cam1' ? 'Fundos' : 'Entrada');
            const summaryText = `${target} em ${camCode} (${camName})`;

            const newNotif = {
              id: String(Date.now()),
              text: summaryText,
              time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
              read: false,
            };
            setNotifications((prev) => [newNotif, ...prev.slice(0, 9)]);

            const browserCooldownMs = Math.max(0, notifyCooldownRef.current) * 1000;
            const canShowBrowserNotif =
              Boolean(data.force) ||
              browserCooldownMs === 0 ||
              Date.now() - lastWinNotifyAtRef.current >= browserCooldownMs;

            if (
              canShowBrowserNotif &&
              windowsNotifyRef.current &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              lastWinNotifyAtRef.current = Date.now();
              try {
                const winNotif = new Notification(`🚨 Vigia IA — ${target}`, {
                  body: `${camCode} (${camName}) • Permanência de ${data.duration || 5}s`,
                  icon: `/api/ia/snapshot/${camKey}?t=${Date.now()}`,
                  tag: `cftv-alarm-${camKey}`,
                });
                winNotif.onclick = () => {
                  window.focus();
                  setPage('ai');
                  winNotif.close();
                };
              } catch (e) {}
            }
          }
        } catch (e) {}
      };
    } catch (err) {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  // Busca dados de configuração e conectividade do servidor
  const fetchServerData = async () => {
    try {
      const configRes = await fetch('/api/config');
      if (configRes.ok) {
        const configData = await configRes.json();
        if (configData.cameras) setCameras(configData.cameras);
        if (configData.primaryIp) setPrimaryIp(configData.primaryIp);
      }
    } catch (e) {}

    try {
      const statusRes = await fetch('/api/status');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setSystemStatus(statusData);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchServerData();
    const interval = setInterval(fetchServerData, 15000);
    return () => clearInterval(interval);
  }, []);

  const openTvMode = async () => {
    window.location.hash = 'tv';
    setTvMode(true);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch (e) {}
  };

  const exitTvMode = async () => {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setTvMode(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen?.();
      } catch (e) {}
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleClearNotifications = () => {
    setNotifications([]);
    setNotificationsOpen(false);
  };

  if (tvMode) {
    return <TVMode cameras={cameras} onExit={exitTvMode} />;
  }

  const renderContent = () => {
    switch (page) {
      case 'live':
        return (
          <LiveView
            cameras={cameras}
            status={systemStatus}
            onRefreshStatus={fetchServerData}
            onNavigateTab={(tab) => setPage(tab)}
          />
        );
      case 'wall':
        return <WallView cameras={cameras} onOpen={openTvMode} />;
      case 'ai':
        return <AIView cameras={cameras} />;
      case 'record':
        return (
          <RecordView
            cameras={cameras}
            onNavigateTab={(tab) => setPage(tab)}
          />
        );
      case 'network':
        return (
          <NetworkView
            cameras={cameras}
            status={systemStatus}
            primaryIp={primaryIp}
            onRefreshStatus={fetchServerData}
          />
        );
      default:
        return (
          <LiveView
            cameras={cameras}
            status={systemStatus}
            onRefreshStatus={fetchServerData}
            onNavigateTab={(tab) => setPage(tab)}
          />
        );
    }
  };

  return (
    <div className="app-shell">
      {/* Barra Lateral / Sidebar */}
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <div>
            <Icon name="shield" size={21} />
          </div>
          <span>
            <b>CFTV</b>
            <small>COMMAND CENTER</small>
          </span>
        </div>

        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? 'active' : ''}
              onClick={() => {
                setPage(n.id);
                setMobileNav(false);
              }}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.id === 'ai' && unreadCount > 0 && (
                <i className="nav-badge">{unreadCount}</i>
              )}
            </button>
          ))}
        </nav>

        <div className="side-bottom">
          <button onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
            <span>Configurações</span>
          </button>
          <div className="system-ok">
            <i />
            <div>
              <b>Sistema operacional</b>
              <span>TV Box Armbian · v2.4.1</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Backdrop para fechar o menu mobile ao clicar fora */}
      {mobileNav && (
        <div
          className="fixed inset-0 bg-black/60 z-40 sm:hidden"
          onClick={() => setMobileNav(false)}
        />
      )}

      {/* Conteúdo Principal */}
      <main>
        <header>
          <button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)}>
            <Icon name="menu" />
          </button>
          <div className="breadcrumb">
            <span>Central Residencial</span>
            <Icon name="chevron" size={14} />
            <b>{nav.find((n) => n.id === page)?.label}</b>
          </div>
          <div className="header-right relative">
            <div className="clock">
              <b>
                {time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </b>
              <span>
                {time
                  .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                  .replace('.', '')}
              </span>
            </div>

            {/* Sino de Notificações com Dropdown Funcional */}
            <div className="relative">
              <button
                className="bell cursor-pointer"
                title={unreadCount > 0 ? `${unreadCount} alerta(s) de alarme` : 'Nenhum alerta'}
                onClick={() => {
                  setNotificationsOpen(!notificationsOpen);
                  // Marca como lidas ao abrir
                  setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
                }}
              >
                <Icon name="bell" />
                {unreadCount > 0 && <i />}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-[#101416] border border-[#252c30] rounded-lg shadow-2xl p-3 z-50 animate-fade">
                  <div className="flex items-center justify-between pb-2 border-b border-[#252c30] mb-2">
                    <span className="text-xs font-bold text-neutral-200">Alertas Recentes</span>
                    {notifications.length > 0 && (
                      <button
                        className="text-xs text-neutral-400 hover:text-white"
                        onClick={handleClearNotifications}
                      >
                        Limpar
                      </button>
                    )}
                  </div>

                  {notifications.length === 0 ? (
                    <div className="py-4 text-center text-neutral-500 text-xs">
                      Nenhum alerta pendente
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {notifications.map((n) => (
                        <div
                          key={n.id}
                          className="p-2 rounded bg-[#161c1f] border border-[#232a2e] text-xs flex items-start gap-2"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-neutral-200 font-medium leading-tight">{n.text}</p>
                            <span className="text-xs text-neutral-500">{n.time}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    className="w-full mt-2 pt-2 border-t border-[#252c30] text-center text-xs text-lime-400 hover:underline"
                    onClick={() => {
                      setNotificationsOpen(false);
                      setPage('ai');
                    }}
                  >
                    Ver detalhes no Vigia IA →
                  </button>
                </div>
              )}
            </div>

            {/* Status da Mini-VPS / Atalho de Configurações no lugar do RM inútil */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#14191b] border border-[#252c30] text-xs text-neutral-300 hover:border-lime-400/50 hover:text-lime-400 transition-all font-mono"
              title="Mini-VPS TV Box Online - Clique para Configurações"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse" />
              <span>TV BOX</span>
            </button>
          </div>
        </header>

        {renderContent()}
      </main>

      {/* Modal de Configurações */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        cameras={cameras}
        primaryIp={primaryIp}
      />
    </div>
  );
}
