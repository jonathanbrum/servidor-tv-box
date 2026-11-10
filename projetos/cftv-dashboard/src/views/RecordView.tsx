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

  const [recordings, setRecordings] = useState<RecordingItem[]>([
    {
      camId: 'cam2',
      fileName: 'rec_20261110_143208.mp4',
      startTime: '14:32:08',
      endTime: '14:34:22',
      duration: '02:14',
      type: 'Movimento',
      status: 'Disponível',
    },
    {
      camId: 'cam2',
      fileName: 'rec_20261110_121844.mp4',
      startTime: '12:18:44',
      endTime: '12:19:52',
      duration: '01:08',
      type: 'Movimento',
      status: 'Disponível',
    },
    {
      camId: 'cam2',
      fileName: 'rec_20261110_100000.mp4',
      startTime: '10:00:00',
      endTime: '10:30:00',
      duration: '30:00',
      type: 'Contínua',
      status: 'Disponível',
    },
    {
      camId: 'cam2',
      fileName: 'rec_20261110_093000.mp4',
      startTime: '09:30:00',
      endTime: '10:00:00',
      duration: '30:00',
      type: 'Contínua',
      status: 'Disponível',
    },
  ]);

  const fetchRecordings = async () => {
    setLoading(true);
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
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setRecordings(data);
          setActive(0);
        }
      }
    } catch (e) {
      console.warn('[Recordings] Usando lista em cache:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, [selectedCam, dateType]);

  const activeRec = recordings[active] || recordings[0];
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
          {isPlaying ? (
            <video
              src="/samples/gravacao_cam2_h264.mp4"
              controls
              autoPlay
              className="w-full h-full object-cover"
              onEnded={() => setIsPlaying(false)}
            />
          ) : (
            <>
              <img
                src={selectedCam === 'cam2' ? '/samples/gravacao_real_cam2.jpg' : '/test_camera1.jpg'}
                alt="Reprodução da gravação"
                onError={(e) => {
                  e.currentTarget.src = '/samples/carro_portao.jpg';
                }}
              />
              <button className="big-play" onClick={() => setIsPlaying(true)} title="Reproduzir clipe">
                <Icon name="play" size={28} />
              </button>
              <div className="video-timeline">
                <span>00:42</span>
                <i>
                  <em />
                </i>
                <span>{activeRec ? activeRec.duration : '02:14'}</span>
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
            {recordings.map((r, i) => (
              <tr
                key={i}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
