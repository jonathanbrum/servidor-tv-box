import { useCallback, useEffect, useState } from 'react';
import { AiSettings, VigiaStatus } from '../types';

/**
 * Sincroniza configurações e status em tempo real do motor Vigia 2 etapas que roda no servidor.
 */
export function useVigiaMonitor() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [notifyCooldownSeconds, setNotifyCooldownSeconds] = useState<number>(60);
  const [initialVigiaStatus, setInitialVigiaStatus] = useState<VigiaStatus | null>(null);

  const refreshSettings = useCallback(async () => {
    try {
      const [iaRes, notifyRes, statusRes] = await Promise.all([
        fetch('/api/ia/settings'),
        fetch('/api/notify/config'),
        fetch('/api/ia/vigia-status'),
      ]);
      if (iaRes.ok) {
        const data: AiSettings = await iaRes.json();
        setSettings(data);
      }
      if (notifyRes.ok) {
        const notifyCfg = await notifyRes.json();
        const secs = Number(notifyCfg?.cooldownSeconds ?? 60);
        if (Number.isFinite(secs) && secs >= 0) {
          setNotifyCooldownSeconds(secs);
        }
      }
      if (statusRes.ok) {
        const statusData: VigiaStatus = await statusRes.json();
        setInitialVigiaStatus(statusData);
      }
    } catch {
      // Ignora falhas momentâneas de rede
    }
  }, []);

  useEffect(() => {
    refreshSettings();
    const syncTimer = setInterval(refreshSettings, 20000);
    const onUpdated = () => {
      refreshSettings();
    };
    window.addEventListener('cftv-vigia-updated', onUpdated);
    return () => {
      clearInterval(syncTimer);
      window.removeEventListener('cftv-vigia-updated', onUpdated);
    };
  }, [refreshSettings]);

  return {
    vigiaSettings: settings,
    masterVigia: Boolean(settings?.masterVigia),
    windowsNotify: Boolean(settings?.windowsNotify),
    notifyCooldownSeconds,
    initialVigiaStatus,
    refreshVigiaSettings: refreshSettings,
  };
}
