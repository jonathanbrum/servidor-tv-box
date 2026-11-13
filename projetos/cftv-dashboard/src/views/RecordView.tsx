import { useEffect, useState } from 'react';
import { PageTitle } from '../components/PageTitle';
import { Icon } from '../components/Icons';
import { CameraInfo, RecordingItem } from '../types';

interface RecordViewProps {
  cameras: Record<string, CameraInfo>;
  onNavigateTab: (tab: string) => void;
}

export function RecordView({ cameras, onNavigateTab }: RecordViewProps) {
  const [selectedCam, setSelectedCam] = useState<'cam2' | 'cam1'>('cam2');
  const [dateType, setDateType] = useState<'today' | 'yesterday' | 'custom'>('today');
  const [customDate, setCustomDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [active, setActive] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);

  const formatDuration = (sec?: number) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const fetchRecordings = async () => {
    setLoading(true);
    setErrorMsg(null);
    setIsPlaying(false);
    let targetDate = customDate;
    if (dateType === 'today') {
      targetDate = new Date().toISOString().slice(0, 10);
    } else if (dateType === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      targetDate = d.toISOString().slice(0, 10);
    }

    try {
      const res = await fetch(`/api/recordings/${selectedCam}?date=${targetDate}`);
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        setRecordings([]);
        setErrorMsg(data?.error || 'Falha ao consultar gravações da câmera.');
        return;
      }

      const rawList = Array.isArray(data) ? data : (Array.isArray(data?.recordings) ? data.recordings : []);
      const mapped: RecordingItem[] = rawList.map((item: any) => ({
        camId: selectedCam,
        fileName: item.fileName,
        startTime: item.startTime,
        endTime: item.endTime,
        duration: item.duration || formatDuration(item.durationSeconds),
        type: item.typeLabel || (item.type === 'motion' ? 'Movimento' : 'Contínua'),
        status: item.status || 'Disponível',
      }));

      setRecordings(mapped);
      setActive(0);
    } catch (e: any) {
      setRecordings([]);
      setErrorMsg(e?.message || 'Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, [selectedCam, dateType, customDate]);

  const activeRec = recordings[active] || null;
  const activeStreamUrl = activeRec
    ? `/api/recordings/${selectedCam}/stream?fileName=${encodeURIComponent(activeRec.fileName)}&startTime=${encodeURIComponent(activeRec.startTime)}&endTime=${encodeURIComponent(activeRec.endTime)}`
    : '';
  const camName = selectedCam === 'cam2'
    ? (cameras.cam2?.name ? `CAM 2 (${cameras.cam2.name})` : 'Portão principal')
    : (cameras.cam1?.name ? `CAM 1 (${cameras.cam1.name})` : 'Fundos / Jardim');

  const handleDownload = () => {
    if (!activeRec) return;
    const downloadUrl = `/api/recordings/${selectedCam}/stream?fileName=${encodeURIComponent(activeRec.fileName)}&startTime=${encodeURIComponent(activeRec.startTime)}&endTime=${encodeURIComponent(activeRec.endTime)}&download=1`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${selectedCam}_${activeRec.startTime.replace(/[: ]/g, '_')}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="view">
      <PageTitle
        eyebrow="ARMAZENAMENTO LOCAL"
        title="Gravações da câmera"
        description="Consulte e exporte clipes de vídeo gravados na central ou cartão SD."
      />

      <div className="record-filters">
        <label>
          Câmera
          <select
            value={selectedCam}
            onChange={(e) => setSelectedCam(e.target.value as 'cam1' | 'cam2')}
          >
            <option value="cam2">CAM 2 · {cameras.cam2?.name || 'Portão principal'}</option>
            <option value="cam1">CAM 1 · {cameras.cam1?.name || 'Fundos / Jardim'}</option>
          </select>
        </label>

        <label>
          Data selecionada
          <div className="date-input">
            <Icon name="calendar" />
            <input
              type="date"
              className="bg-transparent text-xs text-white outline-none w-full cursor-pointer"
              value={customDate}
              onChange={(e) => {
                setCustomDate(e.target.value);
                setDateType('custom');
              }}
            />
          </div>
        </label>

        <div className="quick-dates">
          <button
            className={dateType === 'today' ? 'active' : ''}
            onClick={() => setDateType('today')}
          >
            Hoje
          </button>
          <button
            className={dateType === 'yesterday' ? 'active' : ''}
            onClick={() => setDateType('yesterday')}
          >
            Ontem
          </button>
        </div>

        <button className="primary-btn" onClick={fetchRecordings} disabled={loading}>
          <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Buscando...' : 'Buscar gravações'}
        </button>
      </div>

      <div className="record-layout">
        <div className="video-player">
          {isPlaying && activeRec ? (
            <video
              key={activeStreamUrl}
              src={activeStreamUrl}
              controls
              autoPlay
              className="w-full h-full object-cover"
              onEnded={() => setIsPlaying(false)}
            />
          ) : (
            <>
              <img
                src={`/api/snapshot/${selectedCam}`}
                alt="Prévia da câmera"
                onError={(e) => {
                  e.currentTarget.src = '/samples/carro_portao.jpg';
                }}
              />
              {activeRec && (
                <button className="big-play" onClick={() => setIsPlaying(true)} title="Reproduzir clipe">
                  <Icon name="play" size={28} />
                </button>
              )}
              <div className="video-timeline">
                <span>{activeRec ? activeRec.startTime.slice(-8) : '00:00'}</span>
                <i>
                  <em />
                </i>
                <span>{activeRec ? activeRec.duration : '00:00'}</span>
              </div>
            </>
          )}
        </div>

        <div className="record-info">
          <span>REPRODUZINDO AGORA</span>
          <h3>{camName}</h3>
          <p>
            {activeRec ? `Início às ${activeRec.startTime} · ${activeRec.type}` : 'Nenhuma gravação'}
          </p>
          <button className="primary-btn" onClick={handleDownload}>
            <Icon name="download" />
            Baixar MP4
          </button>
          <button className="outline-btn" onClick={() => onNavigateTab('ai')}>
            <Icon name="ai" />
            Re-analisar na IA
          </button>
        </div>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>HORÁRIO</th>
              <th>DURAÇÃO</th>
              <th>TIPO</th>
              <th>STATUS</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recordings.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-6 text-neutral-400 text-xs">
                  {loading
                    ? 'Consultando cartão SD / memória da câmera...'
                    : errorMsg || 'Nenhuma gravação encontrada para esta data.'}
                </td>
              </tr>
            ) : (
              recordings.map((r, i) => (
                <tr
                  key={r.fileName || i}
                  className={active === i ? 'selected' : ''}
                  onClick={() => {
                    setActive(i);
                    setIsPlaying(true);
                  }}
                >
                  <td>
                    <b>{r.startTime}</b>
                  </td>
                  <td>{r.duration}</td>
                  <td>
                    <span className={`type-tag ${r.type === 'Movimento' ? 'motion' : ''}`}>
                      {r.type}
                    </span>
                  </td>
                  <td>
                    <span className="available">
                      <i />
                      {r.status}
                    </span>
                  </td>
                  <td>
                    <button onClick={(e) => {
                      e.stopPropagation();
                      setActive(i);
                      setIsPlaying(true);
                    }}>
                      <Icon name="play" size={14} />
                      Reproduzir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
