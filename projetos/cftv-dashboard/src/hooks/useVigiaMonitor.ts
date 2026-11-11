import { useCallback, useEffect, useRef, useState } from 'react';
import { AiSettings } from '../types';
import { COCO_TO_SETTING_CLASS, PRESET_FENCES, isPointInPoly } from '../utils/geometry';

/**
 * Monitora a câmera ao vivo via snapshots periódicos quando o Modo Vigia está ativo,
 * disparando POST /api/ia/alert quando um alvo permanece na cerca virtual.
 */
export function useVigiaMonitor() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [notifyCooldownSeconds, setNotifyCooldownSeconds] = useState<number>(60);
  const settingsRef = useRef<AiSettings | null>(null);
  const cooldownRef = useRef<number>(60);
  const cocoModelRef = useRef<any>(null);
  const loiterStartRef = useRef<number | null>(null);
  const lastAlarmAtRef = useRef<number>(0);

  const refreshSettings = useCallback(async () => {
    try {
      const [iaRes, notifyRes] = await Promise.all([
        fetch('/api/ia/settings'),
        fetch('/api/notify/config'),
      ]);
      if (iaRes.ok) {
        const data: AiSettings = await iaRes.json();
        settingsRef.current = data;
        setSettings(data);
      }
      if (notifyRes.ok) {
        const notifyCfg = await notifyRes.json();
        const secs = Number(notifyCfg?.cooldownSeconds ?? 60);
        if (Number.isFinite(secs) && secs >= 0) {
          cooldownRef.current = secs;
          setNotifyCooldownSeconds(secs);
        }
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

  const masterVigia = Boolean(settings?.masterVigia);

  useEffect(() => {
    if (!masterVigia) {
      loiterStartRef.current = null;
      return;
    }

    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const ensureModel = async () => {
      if (cocoModelRef.current) return cocoModelRef.current;
      let tries = 0;
      while (!(window as any).cocoSsd && tries < 40 && active) {
        await new Promise((r) => setTimeout(r, 250));
        tries++;
      }
      const coco = (window as any).cocoSsd;
      if (!coco || !active) return null;
      try {
        cocoModelRef.current = await coco.load({ base: 'mobilenet_v2' });
        return cocoModelRef.current;
      } catch {
        return null;
      }
    };

    const loadSnapshotImage = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timeout = setTimeout(() => reject(new Error('Timeout snapshot')), 5000);
        img.onload = () => {
          clearTimeout(timeout);
          resolve(img);
        };
        img.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Erro ao carregar snapshot'));
        };
        img.src = url;
      });

    const step = async () => {
      if (!active) return;
      const cfg = settingsRef.current;
      if (!cfg?.masterVigia) return;

      try {
        const model = await ensureModel();
        if (!model || !active) {
          timerId = setTimeout(step, 3000);
          return;
        }

        const camId = cfg.camId || 'cam2';
        const img = await loadSnapshotImage(`/api/ia/snapshot/${camId}?t=${Date.now()}`);
        if (!active) return;

        const predictions = await model.detect(img);
        const minScore = (cfg.confidence || 55) / 100;
        const enabled = cfg.enabledClasses || ['person', 'car', 'motorcycle'];
        const poly =
          Array.isArray(cfg.fencePoints) && cfg.fencePoints.length >= 3
            ? cfg.fencePoints
            : PRESET_FENCES.portao;

        const scaleX = 600 / (img.naturalWidth || 640);
        const scaleY = 360 / (img.naturalHeight || 360);

        let detectedClass: string | null = null;
        for (const pred of predictions) {
          const mappedClass = COCO_TO_SETTING_CLASS[pred.class];
          if (!mappedClass || !enabled.includes(mappedClass)) continue;
          if (pred.score < minScore) continue;

          const [bx, by, bw, bh] = pred.bbox;
          const cx = (bx + bw / 2) * scaleX;
          const feetY = (by + bh) * scaleY;
          const cy = (by + bh / 2) * scaleY;

          if (isPointInPoly({ x: cx, y: feetY }, poly) || isPointInPoly({ x: cx, y: cy }, poly)) {
            detectedClass = mappedClass;
            break;
          }
        }

        if (detectedClass) {
          if (!loiterStartRef.current) {
            loiterStartRef.current = Date.now();
          }
          const elapsedSec = (Date.now() - loiterStartRef.current) / 1000;
          const requiredSec = Number(cfg.durationSeconds ?? 5);
          const cooldownMs = Math.max(10, cooldownRef.current) * 1000;

          if (elapsedSec >= requiredSec && Date.now() - lastAlarmAtRef.current >= cooldownMs) {
            lastAlarmAtRef.current = Date.now();
            await fetch('/api/ia/alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                camId,
                targetClass: detectedClass,
                duration: Math.max(1, Math.round(elapsedSec)),
              }),
            }).catch(() => {});
          }
        } else {
          loiterStartRef.current = null;
        }
      } catch {
        // Ignora erro pontual de captura e tenta no próximo ciclo
      }

      if (active) {
        timerId = setTimeout(step, 2000);
      }
    };

    step();

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [masterVigia]);

  return {
    vigiaSettings: settings,
    masterVigia,
    windowsNotify: Boolean(settings?.windowsNotify),
    notifyCooldownSeconds,
    refreshVigiaSettings: refreshSettings,
  };
}
