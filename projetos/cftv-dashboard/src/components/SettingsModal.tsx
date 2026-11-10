import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { CameraInfo } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: Record<string, CameraInfo>;
  primaryIp: string;
}

export function SettingsModal({
  isOpen,
  onClose,
  cameras,
  primaryIp,
}: SettingsModalProps) {
  const [tuyaAccessId, setTuyaAccessId] = useState('');
  const [tuyaAccessSecret, setTuyaAccessSecret] = useState('');
  const [tuyaHomeId, setTuyaHomeId] = useState('');
  const [tuyaEnabled, setTuyaEnabled] = useState(true);
  const [saved, setSaved] = useState(false);
  const [testingTuya, setTestingTuya] = useState(false);
  const [tuyaStatus, setTuyaStatus] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetch('/api/tuya/config')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            setTuyaEnabled(Boolean(data.enabled));
            setTuyaHomeId(data.homeId || '');
            if (data.accessId) setTuyaAccessId(data.accessId);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestTuyaConnection = async () => {
    setTestingTuya(true);
    setTuyaStatus('Testando comunicação...');
    try {
      const res = await fetch('/api/tuya/devices');
      const data = await res.json();
      if (data.success) {
        setTuyaStatus(`✓ Conectado! ${data.devices?.length || 0} aparelho(s) detectado(s).`);
      } else {
        setTuyaStatus('Falha: ' + (data.error || 'Verifique as credenciais'));
      }
    } catch (e: any) {
      setTuyaStatus('Erro de conexão com o servidor');
    } finally {
      setTestingTuya(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);

    try {
      const payload: any = {
        enabled: tuyaEnabled,
        homeId: tuyaHomeId,
      };
      if (tuyaAccessId && !tuyaAccessId.includes('...')) {
        payload.accessId = tuyaAccessId;
      }
      if (tuyaAccessSecret) {
        payload.accessSecret = tuyaAccessSecret;
      }

      await fetch('/api/tuya/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {}

    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#101416] border border-[#252c30] rounded-xl max-w-lg w-full p-6 text-white shadow-2xl animate-fade my-auto">
        <div className="flex items-center justify-between pb-4 border-b border-[#252c30]">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-[#c5f36a] text-[#10160c] grid place-items-center">
              <Icon name="settings" size={18} />
            </span>
            <div>
              <h2 className="text-base font-bold">Configurações da Central</h2>
              <p className="text-xs text-[#788288]">Rede, câmeras locais e Nuvem Smart Life / Tuya</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#788288] hover:text-white text-lg p-1"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 mt-4">
          <div>
            <label className="block text-xs text-[#788288] mb-1">
              IP Primário da TV Box / Servidor
            </label>
            <input
              type="text"
              readOnly
              value={primaryIp}
              className="w-full bg-[#151a1d] border border-[#252c30] rounded-lg px-3 py-2 text-xs text-[#c5f36a] font-mono outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-[#151a1d] border border-[#252c30] rounded-lg">
              <span className="text-xs text-[#788288] uppercase block">CAM 1 (Fundos)</span>
              <strong className="text-xs block text-white mt-1">
                {cameras.cam1?.host || '192.168.1.134'}:554
              </strong>
              <small className="text-xs text-lime-400">RTSP / TCP Nativo</small>
            </div>
            <div className="p-3 bg-[#151a1d] border border-[#252c30] rounded-lg">
              <span className="text-xs text-[#788288] uppercase block">CAM 2 (Entrada)</span>
              <strong className="text-xs block text-white mt-1">
                {cameras.cam2?.host || '192.168.0.102'}:554
              </strong>
              <small className="text-xs text-lime-400">Sofia XMeye: 34567</small>
            </div>
          </div>

          {/* Seção Smart Life / Tuya Cloud */}
          <div className="p-3.5 bg-[#14191b] border border-[#252c30] rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-lime-400 flex items-center gap-1.5">
                <span>⚡</span> Credenciais Smart Life / Tuya Cloud
              </span>
              <button
                type="button"
                className={`switch ${tuyaEnabled ? 'on' : ''}`}
                onClick={() => setTuyaEnabled(!tuyaEnabled)}
              >
                <i />
              </button>
            </div>

            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Access ID / Client ID:
              </label>
              <input
                type="text"
                value={tuyaAccessId}
                onChange={(e) => setTuyaAccessId(e.target.value)}
                placeholder="Ex: sf35a3ewrhwq4qdxv3yj"
                className="w-full bg-[#101416] border border-[#252c30] rounded px-2.5 py-1.5 text-xs text-white font-mono outline-none focus:border-lime-400"
              />
            </div>

            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Access Secret:
              </label>
              <input
                type="password"
                value={tuyaAccessSecret}
                onChange={(e) => setTuyaAccessSecret(e.target.value)}
                placeholder="Digite a chave secreta Tuya"
                className="w-full bg-[#101416] border border-[#252c30] rounded px-2.5 py-1.5 text-xs text-white font-mono outline-none focus:border-lime-400"
              />
            </div>

            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Home ID da Casa (Smart Life):
              </label>
              <input
                type="text"
                value={tuyaHomeId}
                onChange={(e) => setTuyaHomeId(e.target.value)}
                placeholder="Ex: 305545691"
                className="w-full bg-[#101416] border border-[#252c30] rounded px-2.5 py-1.5 text-xs text-white font-mono outline-none focus:border-lime-400"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleTestTuyaConnection}
                disabled={testingTuya}
                className="px-2.5 py-1 rounded bg-[#1f272a] hover:bg-[#283236] text-xs text-lime-400 border border-[#30383b]"
              >
                {testingTuya ? 'Verificando...' : '🔍 Testar Conexão Tuya'}
              </button>
              {tuyaStatus && (
                <span className="text-xs text-lime-400 font-mono">
                  {tuyaStatus}
                </span>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-[#252c30] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="outline-btn"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="primary-btn"
            >
              {saved ? '✓ Salvo com sucesso!' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
