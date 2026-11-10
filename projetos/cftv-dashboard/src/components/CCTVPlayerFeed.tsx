import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';

declare global {
  interface Window {
    JSMpeg?: any;
  }
}

interface CCTVPlayerFeedProps {
  camId?: string;
  name: string;
  index: number;
  offline?: boolean;
  ai?: boolean;
  compact?: boolean;
  quality?: 'HD 1080p' | 'SD Econômico' | string;
  latency?: number;
  sampleImg?: string;
  fit?: 'contain' | 'cover' | 'fill';
  onReconnect?: () => void;
}

export function StatusPill({
  children,
  warn = false,
}: {
  children: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <span className={`status-pill ${warn ? 'warn' : ''}`}>
      <i />
      {children}
    </span>
  );
}

export function CCTVPlayerFeed({
  camId = 'cam1',
  name,
  offline = false,
  ai = false,
  compact = false,
  quality = 'ECO 1s',
  latency = 34,
  sampleImg,
  fit = 'cover',
  onReconnect,
}: CCTVPlayerFeedProps) {
  const [zoom, setZoom] = useState(1);
  const [reconnecting, setReconnecting] = useState(false);
  const [fps, setFps] = useState(0);
  const [hasStream, setHasStream] = useState(false);
  const [useFallbackSnapshot, setUseFallbackSnapshot] = useState(false);
  const [mountKey, setMountKey] = useState(0);

  // Estados específicos para o Modo ECO
  const [ecoSnapshotUrl, setEcoSnapshotUrl] = useState<string>('');
  const [ecoLoaded, setEcoLoaded] = useState(false);
  const [ecoLastUpdate, setEcoLastUpdate] = useState<string>('');

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<any>(null);
  const frameCountRef = useRef(0);
  const lastCalcRef = useRef(performance.now());

  const currentFit = fit || 'contain';
  const fitClass = currentFit === 'cover' ? 'object-cover' : (currentFit === 'fill' ? 'object-fill' : 'object-contain');

  // Foto real local de fallback caso o streaming ao vivo esteja offline
  const localRealPhoto = sampleImg || (camId === 'cam1' ? '/test_camera1.jpg' : '/test_camera2.jpg');

  const isEco = quality.toLowerCase().includes('eco');
  const ecoIntervalMs = quality.includes('2s') ? 2000 : (quality.includes('5s') ? 5000 : 1000);

  // Ao alternar abas do navegador (visibilitychange), reconecta instantaneamente ao retornar
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !offline) {
        setMountKey((prev) => prev + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [offline]);

  // Gerenciamento de Exibição: Modo ECO (Snapshots Periódicos 0% CPU) vs Modo Stream (JSMpeg 25 FPS)
  useEffect(() => {
    if (offline) {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (e) {}
        playerRef.current = null;
      }
      setHasStream(false);
      return;
    }

    let isMounted = true;

    // 1. MODO ECO: Destrói qualquer stream ativo e puxa fotos em loop sem transcode de CPU
    if (isEco) {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (e) {}
        playerRef.current = null;
      }
      setHasStream(false);
      setUseFallbackSnapshot(false);

      let timer: NodeJS.Timeout | null = null;

      const fetchSnapshot = () => {
        if (!isMounted || offline) return;
        const nextUrl = `/api/snapshot/${camId}?t=${Date.now()}`;
        const img = new Image();
        img.onload = () => {
          if (!isMounted) return;
          setEcoSnapshotUrl(nextUrl);
          setEcoLoaded(true);
          setEcoLastUpdate(new Date().toLocaleTimeString('pt-BR'));
          timer = setTimeout(fetchSnapshot, ecoIntervalMs);
        };
        img.onerror = () => {
          if (!isMounted) return;
          timer = setTimeout(fetchSnapshot, 2500);
        };
        img.src = nextUrl;
      };

      fetchSnapshot();

      return () => {
        isMounted = false;
        if (timer) clearTimeout(timer);
      };
    }

    // 2. MODO STREAM: Conecta JSMpeg WebSocket para vídeo 25 FPS
    const canvas = canvasRef.current;
    if (!canvas || !window.JSMpeg) {
      setUseFallbackSnapshot(true);
      return;
    }

    let decodedFirst = false;
    let lastDecodedTime = Date.now();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isSd = quality.toLowerCase().includes('sd');
    const subtype = isSd ? 1 : 0;
    const wsUrl = `${protocol}//${window.location.host}/api/stream/${camId}?subtype=${subtype}&quality=${isSd ? 'sd' : 'hd'}`;

    // Fallback suave após 5s se a câmera demorar para responder (sem abortar a conexão)
    let streamTimeout: NodeJS.Timeout | null = setTimeout(() => {
      if (!decodedFirst && isMounted) {
        setUseFallbackSnapshot(true);
      }
    }, 5000);

    try {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (e) {}
        playerRef.current = null;
      }

      playerRef.current = new window.JSMpeg.Player(wsUrl, {
        canvas: canvas,
        autoplay: true,
        audio: false,
        loop: false,
        disableGl: false,
        pauseWhenHidden: false,
        videoBufferSize: 512 * 1024,
        onVideoDecode: () => {
          if (!isMounted) return;
          lastDecodedTime = Date.now();
          frameCountRef.current++;
          if (!decodedFirst) {
            decodedFirst = true;
            setHasStream(true);
            setUseFallbackSnapshot(false);
            if (streamTimeout) clearTimeout(streamTimeout);
          }
        },
      });
    } catch (err) {
      console.warn(`[CCTV] Falha ao conectar JSMpeg para ${camId}:`, err);
      if (isMounted) setUseFallbackSnapshot(true);
    }

    // Medidor de FPS em tempo real
    const fpsTimer = setInterval(() => {
      const now = performance.now();
      const deltaSec = (now - lastCalcRef.current) / 1000;
      const currentFps = Math.round(frameCountRef.current / (deltaSec || 1));
      frameCountRef.current = 0;
      lastCalcRef.current = now;
      if (currentFps > 0 && isMounted) {
        setFps(currentFps);
      }
    }, 1000);

    // Watchdog: detecta stream estagnado se decorrerem mais de 6s sem novos quadros
    const watchdogTimer = setInterval(() => {
      if (decodedFirst && Date.now() - lastDecodedTime > 6000 && isMounted && !offline) {
        console.warn(`[CCTV] Watchdog detectou fluxo parado em ${camId}, reiniciando...`);
        setHasStream(false);
        setMountKey((k) => k + 1);
      }
    }, 3000);

    return () => {
      isMounted = false;
      if (streamTimeout) clearTimeout(streamTimeout);
      clearInterval(fpsTimer);
      clearInterval(watchdogTimer);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (e) {}
        playerRef.current = null;
      }
    };
  }, [camId, offline, quality, mountKey]);

  const handleDownloadSnapshot = (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = `/api/snapshot/${camId}?download=1&t=${Date.now()}`;
    link.download = `snapshot_${camId}_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleMaximize = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen?.().catch(() => {});
    }
  };

  const handleReconnectClick = () => {
    setReconnecting(true);
    setHasStream(false);
    setUseFallbackSnapshot(false);
    setMountKey((k) => k + 1);
    if (onReconnect) onReconnect();
    setTimeout(() => {
      setReconnecting(false);
    }, 1200);
  };

  if (offline) {
    return (
      <div className="camera-card offline-card">
        <div className="offline-icon">
          <Icon name="alert" size={24} />
        </div>
        <strong>Câmera indisponível</strong>
        <span>{camId.toUpperCase()} · Sem resposta de rede TCP</span>
        <button className="primary-btn small" onClick={handleReconnectClick} disabled={reconnecting}>
          <Icon name="refresh" size={14} className={reconnecting ? 'animate-spin' : ''} />
          {reconnecting ? 'Reconectando...' : 'Reconectar'}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`camera-card ${compact ? 'compact' : ''} fit-${currentFit} bg-[#0b0f11] relative overflow-hidden`}
    >
      {/* MODO ECO: Snapshot Periódico Leve (0% CPU) */}
      {isEco ? (
        <img
          key={`eco-${camId}`}
          src={ecoSnapshotUrl || localRealPhoto}
          alt={`Snapshot da câmera ${name}`}
          className={`absolute inset-0 w-full h-full ${fitClass} transition-opacity duration-300 ${ecoLoaded ? 'opacity-100' : 'opacity-60'}`}
          style={{
            transform: `scale(${zoom})`,
            zIndex: 1,
          }}
        />
      ) : (
        /* MODO STREAM: Canvas JSMpeg 25 FPS */
        <canvas
          key={`${camId}-${quality}-${mountKey}`}
          ref={canvasRef}
          className={`absolute inset-0 w-full h-full ${fitClass} transition-opacity duration-300`}
          style={{
            transform: `scale(${zoom})`,
            opacity: hasStream ? 1 : 0,
            zIndex: 1,
          }}
        />
      )}

      {/* Pré-load tático profissional escuro (enquanto sincroniza o stream ao vivo) */}
      {!isEco && !hasStream && !useFallbackSnapshot && (
        <div className="absolute inset-0 z-0 flex flex-col items-center justify-center bg-[#090d0f] text-neutral-400">
          <div className="relative flex items-center justify-center w-12 h-12 mb-3">
            <span className="absolute w-12 h-12 rounded-full border border-lime-400/30 animate-ping" />
            <span className="w-8 h-8 rounded-full border border-lime-400/60 grid place-items-center text-lime-400">
              <Icon name="camera" size={16} />
            </span>
          </div>
          <span className="text-xs font-mono tracking-wider text-lime-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-lime-400 animate-pulse" />
            SINCRONIZANDO STREAM...
          </span>
          <span className="text-xs text-neutral-500 mt-1">{name}</span>
        </div>
      )}

      {/* Snapshot real local de fallback caso o streaming demore para responder */}
      {!isEco && !hasStream && useFallbackSnapshot && (
        <img
          src={localRealPhoto}
          alt={`Snapshot da câmera ${name}`}
          className={`absolute inset-0 w-full h-full ${fitClass} brightness-75`}
          style={{ transform: `scale(${zoom})` }}
        />
      )}

      <div className="camera-shade z-[2]" />

      {/* Topo do Feed */}
      <div className="camera-top z-[3]">
        <div>
          <StatusPill warn={false}>
            {isEco ? '🍃 ECO' : (hasStream ? 'AO VIVO' : 'CONECTANDO')}
          </StatusPill>
          <span className="camera-name">{name}</span>
        </div>
        <span className="telemetry">
          {isEco
            ? `SNAPSHOT · ${ecoLastUpdate || 'Atualizando...'}`
            : (hasStream ? `${fps || 25} FPS · ${latency} ms` : 'STANDBY')}
        </span>
      </div>

      {/* Barra Inferior de Ações e Zoom */}
      <div className="camera-bottom z-[3]">
        <span>{camId.toUpperCase()}</span>
        <div className="camera-actions">
          <button title="Capturar Snapshot PNG" onClick={handleDownloadSnapshot}>
            <Icon name="camera" size={16} />
          </button>
          <button title="Diminuir zoom" onClick={() => setZoom(Math.max(1, Number((zoom - 0.1).toFixed(1))))}>
            <Icon name="minus" size={15} />
          </button>
          <span>{zoom.toFixed(1)}x</span>
          <button title="Aumentar zoom" onClick={() => setZoom(Math.min(2.0, Number((zoom + 0.1).toFixed(1))))}>
            <Icon name="plus" size={15} />
          </button>
          <button title="Maximizar" onClick={handleMaximize}>
            <Icon name="maximize" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
