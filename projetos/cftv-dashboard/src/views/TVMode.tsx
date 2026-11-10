import { useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { CCTVPlayerFeed } from '../components/CCTVPlayerFeed';
import { CameraInfo } from '../types';

interface TVModeProps {
  cameras: Record<string, CameraInfo>;
  onExit: () => void;
}

export function TVMode({ cameras, onExit }: TVModeProps) {
  // Inicializa recuperando a última visualização salva
  const [layout, setLayout] = useState<'single' | 'split'>(() => {
    const saved = localStorage.getItem('cctv_view_layout');
    return saved === 'single' ? 'single' : 'split';
  });

  const [camera, setCamera] = useState<'cam2' | 'cam1'>(() => {
    const saved = localStorage.getItem('cctv_focused_cam');
    return saved === 'cam1' ? 'cam1' : 'cam2';
  });

  const [fit, setFit] = useState<'fit' | 'fill'>(() => {
    const saved = localStorage.getItem('cctv_tv_fit');
    return saved === 'fill' ? 'fill' : 'fit'; // Padrão 'fit' para evitar cortes de imagem
  });

  const [quality, setQuality] = useState<'ECO' | 'HD' | 'SD'>(() => {
    const saved = localStorage.getItem('cctv_quality');
    if (saved && saved.toLowerCase().includes('hd')) return 'HD';
    if (saved && saved.toLowerCase().includes('sd')) return 'SD';
    return 'ECO';
  });

  const [time, setTime] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [tvAlarmBanner, setTvAlarmBanner] = useState<string | null>(null);

  const showTvToast = (msg: string) => {
    setToastMessage(msg);
    setControlsVisible(true);
  };

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Persistência das alterações com feedback
  const handleSetLayout = (newLayout: 'single' | 'split') => {
    setLayout(newLayout);
    localStorage.setItem('cctv_view_layout', newLayout);
  };

  const handleSetCamera = (newCam: 'cam2' | 'cam1') => {
    setCamera(newCam);
    localStorage.setItem('cctv_focused_cam', newCam);
  };

  const handleSetFit = (newFit: 'fit' | 'fill') => {
    setFit(newFit);
    localStorage.setItem('cctv_tv_fit', newFit);
  };

  const handleSetQuality = (newQuality: 'ECO' | 'HD' | 'SD') => {
    setQuality(newQuality);
    localStorage.setItem('cctv_quality', newQuality === 'ECO' ? 'ECO 1s' : (newQuality === 'HD' ? 'HD 1080p' : 'SD Econômico'));
  };

  // Relógio e WakeLock
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);

    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Fallback para Smart TVs sem WakeLock
      }
    };
    requestWakeLock();

    return () => {
      clearInterval(timer);
      if (wakeLock) {
        try { wakeLock.release(); } catch (e) {}
      }
    };
  }, []);

  // Suporte a Teclas de Controle Remoto de Smart TV e Android TV (D-Pad: Setas, OK, Voltar)
  useEffect(() => {
    const handleRemoteControl = (e: KeyboardEvent) => {
      const key = e.key;
      const code = e.keyCode || e.which;

      // 1. Botão Voltar / Return (Back do controle da TV / Android / webOS / Tizen)
      if (
        key === 'Escape' ||
        key === 'Back' ||
        key === 'BrowserBack' ||
        code === 27 ||
        code === 461 ||
        code === 10009 ||
        code === 8 ||
        code === 4
      ) {
        e.preventDefault();
        if (menuOpen) {
          setMenuOpen(false);
        } else if (layout === 'single') {
          handleSetLayout('split');
          showTvToast('Visualização Dupla (Split 2)');
        } else {
          onExit();
        }
        return;
      }

      // 2. Quando o menu está ABERTO:
      // O navegador da TV gerencia a navegação espacial nativa com as setas entre os botões.
      // Apenas tratamos atalhos especiais de fechar caso necessário.
      if (menuOpen) {
        if (key === 'm' || key === 'M') {
          e.preventDefault();
          setMenuOpen(false);
        }
        return;
      }

      // 3. Quando o menu está FECHADO (Navegação D-Pad Direta nas Câmeras):
      // Seta Esquerda: Foca Câmera 1 (Fundos)
      if (key === 'ArrowLeft') {
        e.preventDefault();
        handleSetCamera('cam1');
        handleSetLayout('single');
        showTvToast(`CAM 1 (${cameras.cam1?.name || 'Fundos'}) · Tela Cheia`);
        return;
      }

      // Seta Direita: Foca Câmera 2 (Entrada)
      if (key === 'ArrowRight') {
        e.preventDefault();
        handleSetCamera('cam2');
        handleSetLayout('single');
        showTvToast(`CAM 2 (${cameras.cam2?.name || 'Entrada'}) · Tela Cheia`);
        return;
      }

      // Seta para Baixo ou OK (Enter): Alterna entre Split (2 Câmeras) e 1 Câmera em foco
      if (key === 'ArrowDown' || key === 'Enter' || code === 13) {
        e.preventDefault();
        const nextLayout = layout === 'split' ? 'single' : 'split';
        handleSetLayout(nextLayout);
        showTvToast(nextLayout === 'split' ? 'Split 2 Câmeras' : `Foco ${camera.toUpperCase()}`);
        return;
      }

      // Seta para Cima ou tecla 'M': Abre o Menu de Configurações
      if (key === 'ArrowUp' || key === 'm' || key === 'M') {
        e.preventDefault();
        setMenuOpen(true);
        return;
      }
    };

    window.addEventListener('keydown', handleRemoteControl);
    return () => window.removeEventListener('keydown', handleRemoteControl);
  }, [layout, camera, fit, quality, menuOpen, cameras, onExit]);

  // Ao abrir o menu, foca automaticamente no primeiro botão para controle via D-Pad
  useEffect(() => {
    if (menuOpen) {
      setTimeout(() => {
        const firstBtn = document.querySelector<HTMLButtonElement>('.tv-camera-options button.active') ||
                         document.querySelector<HTMLButtonElement>('.tv-menu button');
        firstBtn?.focus();
      }, 50);
    }
  }, [menuOpen]);

  // Auto-ocultar controles e cursor após inatividade para visão limpa da TV
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    const wakeControls = () => {
      setControlsVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!menuOpen) {
          setControlsVisible(false);
        }
      }, 4500);
    };

    wakeControls();

    const onUserActivity = () => wakeControls();
    window.addEventListener('mousemove', onUserActivity);
    window.addEventListener('touchstart', onUserActivity);
    window.addEventListener('keydown', onUserActivity);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('mousemove', onUserActivity);
      window.removeEventListener('touchstart', onUserActivity);
      window.removeEventListener('keydown', onUserActivity);
    };
  }, [menuOpen]);

  // Escuta alertas de IA via SSE
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let bannerTimer: NodeJS.Timeout | null = null;

    try {
      eventSource = new EventSource('/api/ia/events');
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'alarm') {
            const target = data.targetClass === 'car' ? 'Carro' : 'Pessoa';
            setTvAlarmBanner(`🚨 ALERTA: ${target} parada na cerca virtual do portão!`);
            setControlsVisible(true);

            // Alarme sonoro potente de segurança
            try {
              const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
              if (AudioContextClass) {
                const audioCtx = new AudioContextClass();
                if (audioCtx.state === 'suspended') audioCtx.resume();
                const now = audioCtx.currentTime;
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.linearRampToValueAtTime(1350, now + 0.35);
                osc.frequency.linearRampToValueAtTime(800, now + 0.7);
                osc.frequency.linearRampToValueAtTime(1350, now + 1.05);
                osc.frequency.linearRampToValueAtTime(800, now + 1.4);
                gain.gain.setValueAtTime(0.4, now);
                gain.gain.setValueAtTime(0.4, now + 1.3);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 1.6);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + 1.6);
              }
            } catch (e) {}

            if (bannerTimer) clearTimeout(bannerTimer);
            bannerTimer = setTimeout(() => setTvAlarmBanner(null), 9000);
          }
        } catch (e) {}
      };
    } catch (e) {}

    return () => {
      if (eventSource) eventSource.close();
      if (bannerTimer) clearTimeout(bannerTimer);
    };
  }, []);

  const cam1Name = cameras.cam1?.name ? `CAM 1 (${cameras.cam1.name})` : 'Fundos / Jardim';
  const cam2Name = cameras.cam2?.name ? `CAM 2 (${cameras.cam2.name})` : 'Portão principal';

  return (
    <div className={`tv-mode tv-${fit} ${!controlsVisible && !menuOpen ? 'hide-controls' : ''}`}>
      {/* Toast de Feedback do Controle Remoto */}
      {toastMessage && (
        <div className="tv-toast-popup">
          <Icon name="wall" size={18} className="text-lime-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Banner de Alarme da IA */}
      {tvAlarmBanner && (
        <div className="tv-alarm-banner">
          <span>{tvAlarmBanner}</span>
        </div>
      )}

      {/* Topo do Modo TV */}
      <div className="tv-topbar">
        <div className="tv-brand">
          <span>
            <Icon name="shield" size={28} />
          </span>
          <div>
            <b>CFTV COMMAND CENTER</b>
            <small>Central Residencial · Smart TV & Wallboard</small>
          </div>
        </div>
        <div className="tv-clock">
          <b>{time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>
          <span>
            {time.toLocaleDateString('pt-BR', {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
            })}
          </span>
        </div>
      </div>

      {/* Grade de Feeds em Tela Cheia */}
      <div className={`tv-feeds ${layout}`}>
        <CCTVPlayerFeed
          camId={camera}
          name={camera === 'cam2' ? cam2Name : cam1Name}
          index={camera === 'cam2' ? 0 : 1}
          quality={quality === 'ECO' ? 'ECO 1s' : (quality === 'HD' ? 'HD 1080p' : 'SD Econômico')}
          fit={fit === 'fit' ? 'contain' : 'cover'}
          compact
        />
        {layout === 'split' && (
          <CCTVPlayerFeed
            camId={camera === 'cam2' ? 'cam1' : 'cam2'}
            name={camera === 'cam2' ? cam1Name : cam2Name}
            index={camera === 'cam2' ? 1 : 0}
            quality={quality === 'ECO' ? 'ECO 1s' : (quality === 'HD' ? 'HD 1080p' : 'SD Econômico')}
            fit={fit === 'fit' ? 'contain' : 'cover'}
            compact
          />
        )}
      </div>

      {/* Barra de Status na base */}
      <div className="tv-status">
        <span>
          <i /> SISTEMA ONLINE
        </span>
        <span>
          {layout === 'split' ? '2 CÂMERAS ATIVAS' : `FOCO EM ${camera.toUpperCase()}`} · {quality} · PROPORÇÃO: {fit === 'fit' ? 'AJUSTAR' : 'PREENCHER'}
        </span>
      </div>

      {/* Botão Gatilho do Menu */}
      <button
        className="tv-menu-trigger"
        onClick={() => {
          setMenuOpen(!menuOpen);
          setControlsVisible(true);
        }}
      >
        <Icon name="menu" size={25} />
        {menuOpen ? 'Ocultar menu' : 'Menu TV'}
      </button>

      {/* Menu Suspenso da TV com Legenda do Controle Remoto */}
      {menuOpen && (
        <div className="tv-menu">
          <div className="tv-menu-heading">
            <div>
              <span>CONTROLES DA SMART TV</span>
              <h2>Visualização</h2>
            </div>
            <button onClick={() => setMenuOpen(false)}>Fechar (ESC)</button>
          </div>

          <div className="tv-control-section">
            <label>CÂMERA EM FOCO</label>
            <div className="tv-camera-options">
              <button
                className={camera === 'cam2' ? 'active' : ''}
                onClick={() => {
                  handleSetCamera('cam2');
                  showTvToast('Foco: CAM-02 Entrada');
                }}
              >
                <span>CAM-02</span>
                <b>{cameras.cam2?.name || 'Entrada / Portão'}</b>
              </button>
              <button
                className={camera === 'cam1' ? 'active' : ''}
                onClick={() => {
                  handleSetCamera('cam1');
                  showTvToast('Foco: CAM-01 Fundos');
                }}
              >
                <span>CAM-01</span>
                <b>{cameras.cam1?.name || 'Fundos / Jardim'}</b>
              </button>
            </div>
          </div>

          <div className="tv-settings-grid">
            <div>
              <label>LAYOUT</label>
              <div className="tv-segment">
                <button
                  className={layout === 'single' ? 'active' : ''}
                  onClick={() => {
                    handleSetLayout('single');
                    showTvToast('Layout: 1 câmera');
                  }}
                >
                  <Icon name="maximize" /> 1 câmera
                </button>
                <button
                  className={layout === 'split' ? 'active' : ''}
                  onClick={() => {
                    handleSetLayout('split');
                    showTvToast('Layout: Split 2');
                  }}
                >
                  <Icon name="wall" /> Split 2
                </button>
              </div>
            </div>

            <div>
              <label>PROPORÇÃO</label>
              <div className="tv-segment">
                <button
                  className={fit === 'fit' ? 'active' : ''}
                  onClick={() => {
                    handleSetFit('fit');
                    showTvToast('Proporção: Ajustar (100% Visível)');
                  }}
                  title="Ajustar proporção original sem cortes"
                >
                  Ajustar
                </button>
                <button
                  className={fit === 'fill' ? 'active' : ''}
                  onClick={() => {
                    handleSetFit('fill');
                    showTvToast('Proporção: Preencher Tela');
                  }}
                  title="Preencher tela cheia"
                >
                  Preencher
                </button>
              </div>
            </div>

            <div>
              <label>QUALIDADE</label>
              <div className="tv-segment">
                <button
                  className={quality === 'ECO' ? 'active' : ''}
                  onClick={() => {
                    handleSetQuality('ECO');
                    showTvToast('🍃 Modo ECO 1s (Snapshots Leves)');
                  }}
                >
                  ECO 1s
                </button>
                <button
                  className={quality === 'HD' ? 'active' : ''}
                  onClick={() => {
                    handleSetQuality('HD');
                    showTvToast('Qualidade: HD 1080p');
                  }}
                >
                  HD 1080p
                </button>
                <button
                  className={quality === 'SD' ? 'active' : ''}
                  onClick={() => {
                    handleSetQuality('SD');
                    showTvToast('Qualidade: SD Econômico');
                  }}
                >
                  SD Econômico
                </button>
              </div>
            </div>
          </div>

          {/* Guia de Controle da Android TV (D-Pad) */}
          <div className="mt-3 p-3 rounded-lg bg-[#101518] border border-[#252c30] text-xs">
            <span className="text-[11px] font-bold text-lime-400 tracking-wider uppercase block mb-2">
              Controle Remoto (Setas Direcionais & OK):
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-neutral-300 font-mono text-[12px]">
              <div className="flex items-center gap-2 p-1.5 rounded bg-neutral-900 border border-neutral-800">
                <span className="px-2 py-0.5 rounded bg-neutral-800 text-lime-400 font-bold border border-neutral-700">←</span>
                <span>Foca <b>CAM 1</b></span>
              </div>
              <div className="flex items-center gap-2 p-1.5 rounded bg-neutral-900 border border-neutral-800">
                <span className="px-2 py-0.5 rounded bg-neutral-800 text-lime-400 font-bold border border-neutral-700">→</span>
                <span>Foca <b>CAM 2</b></span>
              </div>
              <div className="flex items-center gap-2 p-1.5 rounded bg-neutral-900 border border-neutral-800">
                <span className="px-2 py-0.5 rounded bg-neutral-800 text-lime-400 font-bold border border-neutral-700">↓ ou OK</span>
                <span><b>Split / Foco</b></span>
              </div>
              <div className="flex items-center gap-2 p-1.5 rounded bg-neutral-900 border border-neutral-800">
                <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-200 font-bold border border-neutral-700">Voltar</span>
                <span><b>Fechar / Sair</b></span>
              </div>
            </div>
          </div>

          <div className="tv-menu-footer">
            <span>
              <Icon name="check" /> Navegação D-Pad Android TV ativa
            </span>
            <button onClick={onExit}>Sair do Modo TV (Voltar)</button>
          </div>
        </div>
      )}
    </div>
  );
}
