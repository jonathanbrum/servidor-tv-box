import { useState } from 'react';
import { PageTitle } from '../components/PageTitle';
import { CCTVPlayerFeed } from '../components/CCTVPlayerFeed';
import { Icon } from '../components/Icons';
import { CameraInfo } from '../types';

interface WallViewProps {
  cameras: Record<string, CameraInfo>;
  onOpen: () => void;
}

export function WallView({ cameras, onOpen }: WallViewProps) {
  const [selectedCam, setSelectedCam] = useState<'cam2' | 'cam1'>(() => {
    const saved = localStorage.getItem('cctv_focused_cam');
    return saved === 'cam1' ? 'cam1' : 'cam2';
  });

  const [fit, setFit] = useState<'Ajustar' | 'Preencher'>(() => {
    const saved = localStorage.getItem('cctv_tv_fit');
    return saved === 'fill' ? 'Preencher' : 'Ajustar';
  });

  const [quality, setQuality] = useState(() => {
    return localStorage.getItem('cctv_quality') || 'ECO 1s';
  });

  const [awake, setAwake] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleSelectCam = (cam: 'cam2' | 'cam1') => {
    setSelectedCam(cam);
    localStorage.setItem('cctv_focused_cam', cam);
  };

  const handleSelectFit = (f: 'Ajustar' | 'Preencher') => {
    setFit(f);
    localStorage.setItem('cctv_tv_fit', f === 'Preencher' ? 'fill' : 'fit');
  };

  const handleSelectQuality = (q: string) => {
    setQuality(q);
    localStorage.setItem('cctv_quality', q);
  };

  const handleOpenSingle = () => {
    localStorage.setItem('cctv_view_layout', 'single');
    localStorage.setItem('cctv_focused_cam', selectedCam);
    localStorage.setItem('cctv_tv_fit', fit === 'Preencher' ? 'fill' : 'fit');
    onOpen();
  };

  const handleOpenSplit = () => {
    localStorage.setItem('cctv_view_layout', 'split');
    localStorage.setItem('cctv_tv_fit', fit === 'Preencher' ? 'fill' : 'fit');
    onOpen();
  };

  const copyTvLink = async () => {
    const tvUrl = `${window.location.origin}${window.location.pathname}${window.location.search}#tv`;
    try {
      await navigator.clipboard.writeText(tvUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback para prompt manual
      window.prompt('Copie o link abaixo para abrir na Smart TV:', tvUrl);
    }
  };

  const camName = selectedCam === 'cam2'
    ? (cameras.cam2?.name ? `CAM 2 (${cameras.cam2.name})` : 'Portão principal')
    : (cameras.cam1?.name ? `CAM 1 (${cameras.cam1.name})` : 'Fundos / Jardim');

  return (
    <div className="view">
      <PageTitle
        eyebrow="10-FOOT UI"
        title="Modo TV / Wallboard"
        description="Abra diretamente no navegador da Smart TV ou use em monitor dedicado com tela cheia."
        action={
          <div className="wall-actions">
            <button className="outline-btn" onClick={copyTvLink}>
              <Icon name={copied ? 'check' : 'wall'} />
              {copied ? 'Link copiado!' : 'Copiar link para a TV'}
            </button>
            <button className="primary-btn" onClick={handleOpenSingle}>
              <Icon name="maximize" />
              Abrir Modo TV
            </button>
          </div>
        }
      />

      <div className="wallboard">
        <div className="wall-preview">
          <CCTVPlayerFeed
            camId={selectedCam}
            name={camName}
            index={selectedCam === 'cam2' ? 0 : 1}
            quality={quality}
            fit={fit === 'Ajustar' ? 'contain' : 'cover'}
            compact
          />
          <div className="wall-float">
            <button onClick={handleOpenSingle}>
              <Icon name="menu" /> Menu TV
            </button>
            <button onClick={() => handleSelectCam(selectedCam === 'cam2' ? 'cam1' : 'cam2')}>
              <Icon name="grid" /> Alternar câmera
            </button>
            <button onClick={handleOpenSplit}>
              <Icon name="wall" /> Split Tela Cheia
            </button>
          </div>
        </div>

        <aside className="panel">
          <h3>Configuração da tela</h3>
          <label>
            Câmera em foco
            <select
              value={selectedCam}
              onChange={(e) => handleSelectCam(e.target.value as 'cam1' | 'cam2')}
            >
              <option value="cam2">CAM 2 · {cameras.cam2?.name || 'Entrada / Portão'}</option>
              <option value="cam1">CAM 1 · {cameras.cam1?.name || 'Fundos / Jardim'}</option>
            </select>
          </label>

          <label>
            Proporção de exibição
            <div className="segmented full">
              <button
                className={fit === 'Ajustar' ? 'active' : ''}
                onClick={() => handleSelectFit('Ajustar')}
              >
                Ajustar
              </button>
              <button
                className={fit === 'Preencher' ? 'active' : ''}
                onClick={() => handleSelectFit('Preencher')}
              >
                Preencher
              </button>
            </div>
          </label>

          <label>
            Qualidade de transmissão
            <select value={quality} onChange={(e) => handleSelectQuality(e.target.value)}>
              <option value="ECO 1s">🍃 ECO 1s (Snapshots)</option>
              <option value="ECO 2s">🍃 ECO 2s (Econômico)</option>
              <option value="HD 1080p">🎬 HD 1080p (Ao Vivo 25 FPS)</option>
              <option value="SD Econômico">⚡ SD 360p (Ao Vivo Leve)</option>
            </select>
          </label>

          <div className="switch-row">
            <div>
              <b>Bloquear descanso de tela</b>
              <span>Mantém o monitor da TV sempre ativo via WakeLock</span>
            </div>
            <button
              className={`switch ${awake ? 'on' : ''}`}
              onClick={() => setAwake(!awake)}
              title="Ativar/desativar WakeLock"
            >
              <i />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
