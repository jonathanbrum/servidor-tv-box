import { useState } from 'react';
import { PageTitle } from '../components/PageTitle';
import { CCTVPlayerFeed, StatusPill } from '../components/CCTVPlayerFeed';
import { Icon } from '../components/Icons';
import { CameraInfo, SystemStatus } from '../types';

interface LiveViewProps {
  cameras: Record<string, CameraInfo>;
  status: SystemStatus;
  onRefreshStatus: () => void;
  onNavigateTab: (tab: string) => void;
}

export function LiveView({
  cameras,
  status,
  onRefreshStatus,
  onNavigateTab,
}: LiveViewProps) {
  const [layout, setLayout] = useState<'single' | 'split'>(() => {
    const saved = localStorage.getItem('cctv_view_layout');
    return saved === 'single' ? 'single' : 'split';
  });
  const [focusedCam, setFocusedCam] = useState<'cam2' | 'cam1'>(() => {
    const saved = localStorage.getItem('cctv_focused_cam');
    return saved === 'cam1' ? 'cam1' : 'cam2';
  });
  const [quality, setQuality] = useState<string>(() => {
    return localStorage.getItem('cctv_quality') || 'ECO 1s';
  });
  const [fit, setFit] = useState<'contain' | 'cover'>(() => {
    const saved = localStorage.getItem('cctv_live_fit');
    return saved === 'cover' ? 'cover' : 'contain'; // Padrão 'contain' para nunca cortar bordas
  });
  const [retesting, setRetesting] = useState(false);

  const handleSelectLayout = (l: 'single' | 'split') => {
    setLayout(l);
    localStorage.setItem('cctv_view_layout', l);
  };

  const handleSelectFocusedCam = (cam: 'cam2' | 'cam1') => {
    setFocusedCam(cam);
    localStorage.setItem('cctv_focused_cam', cam);
  };

  const handleSelectQuality = (q: string) => {
    setQuality(q);
    localStorage.setItem('cctv_quality', q);
  };

  const handleSelectFit = (newFit: 'contain' | 'cover') => {
    setFit(newFit);
    localStorage.setItem('cctv_live_fit', newFit);
  };

  const cam1Name = cameras.cam1?.name ? `CAM 1 (${cameras.cam1.name})` : 'Fundos / Jardim';
  const cam2Name = cameras.cam2?.name ? `CAM 2 (${cameras.cam2.name})` : 'Portão principal';

  const cam1Connected = status.cam1 ? status.cam1.connected : true;
  const cam2Connected = status.cam2 ? status.cam2.connected : true;

  const cam1Latency = status.cam1?.latency || 42;
  const cam2Latency = status.cam2?.latency || 28;

  const handleRetestAll = () => {
    setRetesting(true);
    onRefreshStatus();
    setTimeout(() => setRetesting(false), 1200);
  };

  return (
    <div className="view">
      <PageTitle
        eyebrow="VISÃO GERAL"
        title="Monitoramento ao vivo"
        description="Acompanhe todos os ambientes em tempo real com streaming de baixa latência."
        action={
          <div className="toolbar">
            <div className="segmented">
              <button
                className={layout === 'single' ? 'active' : ''}
                onClick={() => handleSelectLayout('single')}
              >
                1 câmera
              </button>
              <button
                className={layout === 'split' ? 'active' : ''}
                onClick={() => handleSelectLayout('split')}
              >
                Split 2
              </button>
            </div>

            {layout === 'single' && (
              <div className="segmented">
                <button
                  className={focusedCam === 'cam2' ? 'active' : ''}
                  onClick={() => handleSelectFocusedCam('cam2')}
                  title="Focar na Câmera 2 (Entrada)"
                >
                  CAM 2 (Entrada)
                </button>
                <button
                  className={focusedCam === 'cam1' ? 'active' : ''}
                  onClick={() => handleSelectFocusedCam('cam1')}
                  title="Focar na Câmera 1 (Fundos)"
                >
                  CAM 1 (Fundos)
                </button>
              </div>
            )}

            <div className="segmented">
              <button
                className={fit === 'contain' ? 'active' : ''}
                onClick={() => handleSelectFit('contain')}
                title="Ajustar: Exibe 100% da imagem sem nenhum corte nas bordas"
              >
                📐 Ajustar
              </button>
              <button
                className={fit === 'cover' ? 'active' : ''}
                onClick={() => handleSelectFit('cover')}
                title="Preencher: Preenche todo o quadro (pode cortar bordas se a proporção variar)"
              >
                ↔ Preencher
              </button>
            </div>

            <select value={quality} onChange={(e) => handleSelectQuality(e.target.value)}>
              <option value="ECO 1s">🍃 ECO 1s (Snapshots)</option>
              <option value="ECO 2s">🍃 ECO 2s (Econômico)</option>
              <option value="HD 1080p">🎬 HD 1080p (Ao Vivo 25 FPS)</option>
              <option value="SD Econômico">⚡ SD 360p (Ao Vivo Leve)</option>
            </select>
          </div>
        }
      />

      <div className={`feed-grid ${layout}`}>
        {layout === 'split' ? (
          <>
            <CCTVPlayerFeed
              camId="cam2"
              name={cam2Name}
              index={0}
              quality={quality}
              fit={fit}
              latency={cam2Latency}
              offline={!cam2Connected}
              onReconnect={onRefreshStatus}
            />
            <CCTVPlayerFeed
              camId="cam1"
              name={cam1Name}
              index={1}
              quality={quality}
              fit={fit}
              latency={cam1Latency}
              offline={!cam1Connected}
              onReconnect={onRefreshStatus}
            />
          </>
        ) : (
          <CCTVPlayerFeed
            camId={focusedCam}
            name={focusedCam === 'cam2' ? cam2Name : cam1Name}
            index={focusedCam === 'cam2' ? 0 : 1}
            quality={quality}
            fit={fit}
            latency={focusedCam === 'cam2' ? cam2Latency : cam1Latency}
            offline={focusedCam === 'cam2' ? !cam2Connected : !cam1Connected}
            onReconnect={onRefreshStatus}
          />
        )}
      </div>

      <div className="section-head">
        <div>
          <h2>Dispositivos Conectados</h2>
          <span>2 câmeras ativas no servidor TV Box</span>
        </div>
        <button className="text-btn" onClick={() => onNavigateTab('network')}>
          Diagnóstico de Rede <Icon name="chevron" size={15} />
        </button>
      </div>

      <div className="camera-list">
        {/* Card Real: CAM 2 Entrada */}
        <div
          className={`mini-camera cursor-pointer transition-all ${
            layout === 'single' && focusedCam === 'cam2' ? 'border-lime-400/60 shadow-lg' : ''
          }`}
          onClick={() => {
            handleSelectFocusedCam('cam2');
          }}
          title="Clique para focar na CAM 2 (Entrada)"
        >
          <img src="/test_camera2.jpg" alt="CAM 2 Entrada" onError={(e) => { e.currentTarget.src = '/samples/gravacao_real_cam2.jpg'; }} />
          <div>
            <b>{cam2Name}</b>
            <span>
              {cameras.cam2?.host || '192.168.0.102'} · {cam2Latency} ms
            </span>
          </div>
          <StatusPill warn={!cam2Connected}>{cam2Connected ? 'Online' : 'Offline'}</StatusPill>
        </div>

        {/* Card Real: CAM 1 Fundos */}
        <div
          className={`mini-camera cursor-pointer transition-all ${
            layout === 'single' && focusedCam === 'cam1' ? 'border-lime-400/60 shadow-lg' : ''
          }`}
          onClick={() => {
            handleSelectFocusedCam('cam1');
          }}
          title="Clique para focar na CAM 1 (Fundos)"
        >
          <img src="/test_camera1.jpg" alt="CAM 1 Fundos" />
          <div>
            <b>{cam1Name}</b>
            <span>
              {cameras.cam1?.host || '192.168.1.134'} · {cam1Latency} ms
            </span>
          </div>
          <StatusPill warn={!cam1Connected}>{cam1Connected ? 'Online' : 'Offline'}</StatusPill>
        </div>
      </div>
    </div>
  );
}
