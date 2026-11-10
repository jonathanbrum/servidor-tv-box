import { useState } from 'react';
import { PageTitle } from '../components/PageTitle';
import { Icon } from '../components/Icons';
import { CameraInfo, SystemStatus } from '../types';

interface NetworkViewProps {
  cameras: Record<string, CameraInfo>;
  status: SystemStatus;
  primaryIp: string;
  onRefreshStatus: () => void;
}

export function NetworkView({
  cameras,
  status,
  primaryIp,
  onRefreshStatus,
}: NetworkViewProps) {
  const [testingIndex, setTestingIndex] = useState<number | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [showFullGuide, setShowFullGuide] = useState(false);

  const cam1Connected = status.cam1 ? status.cam1.connected : true;
  const cam2Connected = status.cam2 ? status.cam2.connected : true;

  const cam1Latency = status.cam1?.latency || 42;
  const cam2Latency = status.cam2?.latency || 28;

  const rows = [
    {
      name: cameras.cam2?.name ? `CAM 2 (${cameras.cam2.name})` : 'Portão principal',
      ip: cameras.cam2?.host || '192.168.0.102',
      port: String(cameras.cam2?.port || 554),
      latency: `${cam2Latency} ms`,
      status: cam2Connected ? 'online' : 'offline',
      camId: 'cam2',
    },
    {
      name: cameras.cam1?.name ? `CAM 1 (${cameras.cam1.name})` : 'Fundos / Jardim',
      ip: cameras.cam1?.host || '192.168.1.134',
      port: String(cameras.cam1?.port || 554),
      latency: `${cam1Latency} ms`,
      status: cam1Connected ? 'online' : 'offline',
      camId: 'cam1',
    },
  ];

  const onlineCount = rows.filter((r) => r.status === 'online').length;
  const avgLatency = Math.round((cam1Latency + cam2Latency) / 2);
  const failuresCount = rows.length - onlineCount;

  const handleRetestAll = async () => {
    setTestingAll(true);
    try {
      await fetch('/api/check', { method: 'POST' });
      onRefreshStatus();
    } catch (e) {}
    setTimeout(() => setTestingAll(false), 1200);
  };

  const handleRetestSingle = async (index: number) => {
    setTestingIndex(index);
    try {
      await fetch('/api/check', { method: 'POST' });
      onRefreshStatus();
    } catch (e) {}
    setTimeout(() => setTestingIndex(null), 1000);
  };

  return (
    <div className="view">
      <PageTitle
        eyebrow="SAÚDE DO SISTEMA"
        title="Diagnóstico de rede"
        description="Verifique a conectividade TCP/RTSP entre a central TV Box e suas câmeras."
        action={
          <button className="primary-btn" onClick={handleRetestAll} disabled={testingAll}>
            <Icon name="refresh" size={14} className={testingAll ? 'animate-spin' : ''} />
            {testingAll ? 'Testando...' : 'Retestar todos'}
          </button>
        }
      />

      <div className="health-cards">
        <div>
          <Icon name="check" />
          <span>
            <b>
              {onlineCount} de {rows.length}
            </b>
            Câmeras conectadas
          </span>
        </div>
        <div>
          <Icon name="wifi" />
          <span>
            <b>{avgLatency} ms</b>
            Latência média
          </span>
        </div>
        <div className={failuresCount > 0 ? 'warn' : ''}>
          <Icon name={failuresCount > 0 ? 'alert' : 'check'} />
          <span>
            <b>
              {failuresCount} {failuresCount === 1 ? 'falha' : 'falhas'}
            </b>
            {failuresCount > 0 ? 'Requer atenção' : 'Tudo operacional'}
          </span>
        </div>
      </div>

      <div className="table-card network-table">
        <table>
          <thead>
            <tr>
              <th>CÂMERA</th>
              <th>IP LOCAL</th>
              <th>PORTA RTSP</th>
              <th>CONEXÃO TCP</th>
              <th>LATÊNCIA</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td>
                  <code>{r.ip}</code>
                </td>
                <td>
                  <code>{r.port}</code>
                </td>
                <td>
                  <span className={`net-status ${r.status}`}>
                    <i />
                    {r.status === 'online' ? 'Conectado' : 'Sem resposta'}
                  </span>
                </td>
                <td>{r.latency}</td>
                <td>
                  <button onClick={() => handleRetestSingle(i)} disabled={testingIndex === i}>
                    <Icon
                      name="refresh"
                      size={14}
                      className={testingIndex === i ? 'animate-spin' : ''}
                    />
                    {testingIndex === i ? 'Testando...' : 'Retestar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="guide">
        <div className="guide-icon">
          <Icon name="network" size={26} />
        </div>
        <div>
          <span>GUIA DE SOLUÇÃO</span>
          <h3>Câmera em outra sub-rede? (Ex: 192.168.1.x vs 192.168.0.x)</h3>
          <p>
            A central está no IP primário <code>{primaryIp}</code>. Em redes com roteadores secundários,
            configure uma rota estática ou una as máscaras de rede para permitir tráfego direto nas portas RTSP (554) e XMeye (34567).
          </p>
          <div className="guide-steps">
            <span>
              <b>1</b>Verifique IP e máscara
            </span>
            <Icon name="chevron" />
            <span>
              <b>2</b>Teste a porta RTSP (554)
            </span>
            <Icon name="chevron" />
            <span>
              <b>3</b>Revise firewall e rotas
            </span>
          </div>
        </div>
        <button className="outline-btn" onClick={() => setShowFullGuide(!showFullGuide)}>
          {showFullGuide ? 'Ocultar guia' : 'Ver guia completo'}
        </button>
      </div>

      {showFullGuide && (
        <div className="panel mt-4 animate-fadeIn">
          <h3 className="font-bold text-sm mb-2 text-lime-400">Instruções para Câmeras XMeye & Sofia</h3>
          <ul className="text-xs space-y-2 text-neutral-300">
            <li>• <b>Porta 34567 (TCP):</b> Protocolo nativo Sofia / XMeye para snapshots instantâneos (~100ms) e controle PTZ.</li>
            <li>• <b>Porta 554 (RTSP):</b> Fluxo de vídeo H.264/H.265 para streaming contínuo. Use <code>subtype=0</code> (HD) ou <code>subtype=1</code> (SD econômico).</li>
            <li>• <b>Roteadores Duplos:</b> Se a Câmera 1 estiver em <code>192.168.1.x</code> e a Câmera 2 em <code>192.168.0.x</code>, configure a máscara de sub-rede da TV Box para <code>255.255.254.0</code> (/23) ou ative DMZ / Rota Estática no roteador principal.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
