import { useEffect, useRef, useState } from "react";
import { PageTitle } from "../components/PageTitle";
import { CCTVPlayerFeed } from "../components/CCTVPlayerFeed";
import { NotificationChannelsCard } from "../components/NotificationChannelsCard";
import { Icon } from "../components/Icons";
import { AiSettings, AlertEvent, CameraInfo } from "../types";
import { Point, PRESET_FENCES, isPointInPoly } from "../utils/geometry";

interface AIViewProps {
  cameras: Record<string, CameraInfo>;
}

interface TuyaDevice {
  id: string;
  name: string;
  online?: boolean;
}

interface TuyaScene {
  scene_id: string;
  scene_name: string;
}

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ActiveDetectionState {
  targetClass: string;
  confidence: number;
  duration: number;
  bbox?: BBox;
  camId?: string;
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

let lastSoundPlayTime = 0;

function playAlarmSound(force = false) {
  try {
    const nowMs = Date.now();
    // Evita tocar duas vezes seguidas ou sobrepor sons em menos de 2.2 segundos
    if (!force && nowMs - lastSoundPlayTime < 2200) {
      return;
    }
    lastSoundPlayTime = nowMs;

    const audioCtx = getAudioContext();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sawtooth";

    // Sirene potente de segurança com sweep duplo (800Hz ⇄ 1350Hz) em 1.6s
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
  } catch (e) {
    console.warn("[Sirene] Erro ao reproduzir som:", e);
  }
}

export interface TestSample {
  id: string;
  name: string;
  type: "image" | "video";
  url: string;
  badge: string;
}

const BUILTIN_SAMPLES: TestSample[] = [
  {
    id: "cam2_real",
    name: "CAM 2 (Entrada / Portão)",
    type: "image",
    url: "/samples/cam2_ao_vivo.jpg",
    badge: "Câmera Real",
  },
  {
    id: "cam1_real",
    name: "CAM 1 (Fundos / Jardim)",
    type: "image",
    url: "/samples/cam1_ao_vivo.jpg",
    badge: "Câmera Real",
  },
  {
    id: "carro_portao",
    name: "Carro no Portão",
    type: "image",
    url: "/samples/carro_portao.jpg",
    badge: "Amostra Veículo",
  },
  {
    id: "video_cam2",
    name: "Vídeo Gravado",
    type: "video",
    url: "/samples/gravacao_cam2_h264.mp4",
    badge: "Vídeo H.264",
  },
];

export function AIView({ cameras }: AIViewProps) {
  const [classes, setClasses] = useState<string[]>(["Pessoas", "Carros"]);
  const [testMode, setTestMode] = useState(false);
  const [selectedSampleId, setSelectedSampleId] = useState<string>("cam2_real");
  const [customSamples, setCustomSamples] = useState<TestSample[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const [sensitivity, setSensitivity] = useState(78);
  const [loiterSeconds, setLoiterSeconds] = useState(5);
  const [sirenTesting, setSirenTesting] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookFeedback, setWebhookFeedback] = useState<string | null>(null);

  // Modo Encomenda / Vigia Temporário (Sob Demanda até 12 horas)
  const [masterVigia, setMasterVigia] = useState(false);
  const [windowsNotify, setWindowsNotify] = useState(false);
  const [vigiaDurationHours, setVigiaDurationHours] = useState(4);
  const [vigiaActiveUntil, setVigiaActiveUntil] = useState<number | null>(null);
  const [vigiaTimeRemaining, setVigiaTimeRemaining] = useState<string>("");

  // Estado da Cerca Virtual Interativa
  const [fenceName, setFenceName] = useState("Portão & Calçada");
  const [points, setPoints] = useState<Point[]>(PRESET_FENCES.portao);
  const [isEditing, setIsEditing] = useState(false);
  const [activeVertex, setActiveVertex] = useState<number | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [fenceSaved, setFenceSaved] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const cocoModelRef = useRef<any>(null);
  const loiteringStartRef = useRef<number | null>(null);
  const lastAlarmRef = useRef<number>(0);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [loiterDisplay, setLoiterDisplay] = useState("00:00");

  // Estado de detecção ativa (só aparece quando ocorre detecção real na cerca ou teste manual)
  const [activeDetection, setActiveDetection] = useState<ActiveDetectionState | null>(null);

  // Estado da Integração Tuya / Smart Life
  const [tuyaConfig, setTuyaConfig] = useState({
    enabled: true,
    actionType: "device" as "device" | "scene",
    targetId: "ebbb540edc733d06fbpbl6",
    targetName: "Tomadinha",
    sceneId: "",
    sceneName: "",
    actionCommand: "on",
    hasCredentials: true,
  });
  const [tuyaDevices, setTuyaDevices] = useState<TuyaDevice[]>([]);
  const [tuyaScenes, setTuyaScenes] = useState<TuyaScene[]>([]);
  const [tuyaLoading, setTuyaLoading] = useState(false);
  const [tuyaTesting, setTuyaTesting] = useState(false);
  const [tuyaFeedback, setTuyaFeedback] = useState("");

  const [alerts, setAlerts] = useState<AlertEvent[]>([
    {
      id: "1",
      targetClass: "Pessoa",
      timeFormatted: "Hoje, 14:32:08",
      durationFormatted: "01:42",
      confidence: 96,
      camId: "cam2",
      thumbnailUrl: "/samples/entregador_caixa.jpg",
      timestamp: new Date().toISOString(),
    },
    {
      id: "2",
      targetClass: "Carro",
      timeFormatted: "Hoje, 12:18:44",
      durationFormatted: "00:38",
      confidence: 91,
      camId: "cam2",
      thumbnailUrl: "/samples/carro_portao.jpg",
      timestamp: new Date().toISOString(),
    },
    {
      id: "3",
      targetClass: "Pessoa",
      timeFormatted: "Ontem, 23:06:19",
      durationFormatted: "02:11",
      confidence: 88,
      camId: "cam1",
      thumbnailUrl: "/samples/pessoa_caminhando.jpg",
      timestamp: new Date().toISOString(),
    },
  ]);

  // Carrega configurações gerais, cerca virtual e Tuya do servidor / cache local
  useEffect(() => {
    // Restaura pontos e nome da cerca do cache local imediatamente
    try {
      const cachedPoints = localStorage.getItem("cctv_fence_points");
      if (cachedPoints) {
        const parsed = JSON.parse(cachedPoints);
        if (Array.isArray(parsed) && parsed.length >= 3) {
          setPoints(parsed);
        }
      }
      const cachedName = localStorage.getItem("cctv_fence_name");
      if (cachedName) {
        setFenceName(cachedName);
      }
    } catch (e) {}

    fetch("/api/ia/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: any) => {
        if (data) {
          if (data.vigiaDurationHours !== undefined) setVigiaDurationHours(Number(data.vigiaDurationHours));
          if (data.masterVigia !== undefined) {
            const enabled = Boolean(data.masterVigia);
            setMasterVigia(enabled);
            setVigiaActiveUntil(enabled ? computeLocalVigiaDeadline(data) : null);
          }
          if (data.confidence) setSensitivity(data.confidence);
          if (data.durationSeconds)
            setLoiterSeconds(
              Math.min(10, Math.max(1, Math.round(data.durationSeconds))),
            );
          if (Array.isArray(data.enabledClasses)) {
            const mapped = data.enabledClasses.map((c: string) => {
              if (c === "person") return "Pessoas";
              if (c === "car") return "Carros";
              if (c === "motorcycle") return "Motos";
              return "Animais";
            });
            setClasses(mapped);
          }
          if (
            data.fencePoints &&
            Array.isArray(data.fencePoints) &&
            data.fencePoints.length >= 3
          ) {
            setPoints(data.fencePoints);
          }
          if (data.fenceName) {
            setFenceName(data.fenceName);
          }
          if (data.webhookUrl !== undefined) {
            setWebhookUrl(data.webhookUrl);
          }
          if (typeof data.windowsNotify === "boolean") {
            setWindowsNotify(data.windowsNotify);
          }
        }
      })
      .catch((err) =>
        console.warn("[AI View] Usando configurações padrão:", err),
      );

    loadTuyaConfig();
    loadTuyaDevices();
    loadTuyaScenes();
  }, []);

  const loadTuyaConfig = async () => {
    try {
      const res = await fetch("/api/tuya/config");
      if (res.ok) {
        const data = await res.json();
        setTuyaConfig((prev) => ({ ...prev, ...data }));
      }
    } catch (e) {}
  };

  const loadTuyaDevices = async () => {
    setTuyaLoading(true);
    try {
      const res = await fetch("/api/tuya/devices");
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.devices)) {
          setTuyaDevices(data.devices);
        }
      }
    } catch (e) {
    } finally {
      setTuyaLoading(false);
    }
  };

  const loadTuyaScenes = async () => {
    try {
      const res = await fetch("/api/tuya/scenes");
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.scenes)) {
          setTuyaScenes(data.scenes);
        }
      }
    } catch (e) {}
  };

  const handleToggleTuya = async (enabled: boolean) => {
    setTuyaConfig((prev) => ({ ...prev, enabled }));
    try {
      await fetch("/api/tuya/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch (e) {}
  };

  const handleChangeTuyaActionType = async (actionType: "device" | "scene") => {
    setTuyaConfig((prev) => ({ ...prev, actionType }));
    try {
      await fetch("/api/tuya/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType }),
      });
    } catch (e) {}
  };

  const handleSelectDevice = async (deviceId: string) => {
    const dev = tuyaDevices.find((d) => d.id === deviceId);
    const targetName = dev ? dev.name : "Aparelho";
    setTuyaConfig((prev) => ({ ...prev, targetId: deviceId, targetName }));
    try {
      await fetch("/api/tuya/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: deviceId, targetName }),
      });
    } catch (e) {}
  };

  const handleSelectScene = async (sceneId: string) => {
    const sc = tuyaScenes.find((s) => s.scene_id === sceneId);
    const sceneName = sc ? sc.scene_name : "Cena";
    setTuyaConfig((prev) => ({ ...prev, sceneId, sceneName }));
    try {
      await fetch("/api/tuya/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, sceneName }),
      });
    } catch (e) {}
  };

  const handleTestTuya = async () => {
    setTuyaTesting(true);
    setTuyaFeedback("Enviando...");
    try {
      if (tuyaConfig.actionType === "device") {
        const deviceId = tuyaConfig.targetId || tuyaDevices[0]?.id;
        if (!deviceId) {
          setTuyaFeedback("Nenhum aparelho selecionado");
          setTuyaTesting(false);
          return;
        }
        // Dispara comando de ligar ou piscar
        const res = await fetch("/api/tuya/blink", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, times: 3, intervalMs: 600 }),
        });
        const data = await res.json();
        if (data.success) {
          setTuyaFeedback("✓ Sinal enviado para o aparelho!");
        } else {
          setTuyaFeedback("Erro: " + (data.error || "Falha ao acionar"));
        }
      } else {
        const sceneId = tuyaConfig.sceneId || tuyaScenes[0]?.scene_id;
        if (!sceneId) {
          setTuyaFeedback("Nenhuma cena selecionada");
          setTuyaTesting(false);
          return;
        }
        const res = await fetch("/api/tuya/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId }),
        });
        const data = await res.json();
        if (data.success) {
          setTuyaFeedback("✓ Cena executada com sucesso!");
        } else {
          setTuyaFeedback("Erro ao disparar cena");
        }
      }
    } catch (err: any) {
      setTuyaFeedback("Falha de conexão com a Nuvem Tuya");
    } finally {
      setTuyaTesting(false);
      setTimeout(() => setTuyaFeedback(""), 3500);
    }
  };

  // Escuta alertas reais via Server-Sent Events (SSE)
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let clearTimer: NodeJS.Timeout | null = null;

    try {
      eventSource = new EventSource("/api/ia/events");
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "alarm" || data.type === "detection") {
            const cls =
              data.targetClass === "car"
                ? "Carro"
                : data.targetClass === "motorcycle"
                  ? "Moto"
                  : "Pessoa";
            const newAlert: AlertEvent = {
              id: String(Date.now()),
              targetClass: cls,
              timeFormatted: new Date().toLocaleTimeString("pt-BR"),
              durationFormatted: `00:${String(Math.round(data.duration || 5)).padStart(2, "0")}`,
              confidence: data.confidence || 94,
              camId: data.camId || "cam2",
              thumbnailUrl: "/samples/entregador_moto.jpg",
              timestamp: data.timestamp || new Date().toISOString(),
            };
            setAlerts((prev) => [newAlert, ...prev.slice(0, 9)]);

            // Ativa som de sirene em alarmes reais
            if (data.type === "alarm") {
              playAlarmSound();
            }

            // Ativa overlay dinâmico apenas durante o evento
            setActiveDetection({
              targetClass: cls,
              confidence: data.confidence || 94,
              duration: data.duration || 5,
              camId: data.camId || "cam2",
            });

            if (clearTimer) clearTimeout(clearTimer);
            clearTimer = setTimeout(() => {
              setActiveDetection(null);
            }, 6000);
          }
        } catch (e) {}
      };
    } catch (err) {}

    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      if (eventSource) eventSource.close();
    };
  }, []);

  // Contador regressivo dinâmico da janela do Modo Vigia / Encomenda
  useEffect(() => {
    const updateCountdown = () => {
      if (!masterVigia) {
        setVigiaTimeRemaining("");
        return;
      }
      if (!vigiaActiveUntil) {
        setVigiaTimeRemaining("Monitoramento sem limite");
        return;
      }
      const diffMs = vigiaActiveUntil - Date.now();
      if (diffMs <= 0) {
        setMasterVigia(false);
        setVigiaActiveUntil(null);
        setVigiaTimeRemaining("Expirado");
        return;
      }
      const totalSecs = Math.floor(diffMs / 1000);
      const totalMins = Math.floor(totalSecs / 60);
      const hours = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      const secs = totalSecs % 60;
      if (hours > 0) {
        setVigiaTimeRemaining(`${hours}h ${mins}m restantes`);
      } else if (mins > 0) {
        setVigiaTimeRemaining(`${mins}m ${secs}s restantes`);
      } else {
        setVigiaTimeRemaining(`${secs}s restantes`);
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [masterVigia, vigiaActiveUntil]);

  // Lista combinada de amostras de teste (embutidas + fotos capturadas na hora da câmera)
  const allSamples = [...BUILTIN_SAMPLES, ...customSamples];
  const currentSample = allSamples.find((s) => s.id === selectedSampleId) || BUILTIN_SAMPLES[0];

  const handleCaptureLiveSnapshot = async () => {
    setSnapshotLoading(true);
    try {
      const snapUrl = `/api/snapshot/cam2?t=${Date.now()}`;
      const img = new Image();
      img.src = snapUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        setTimeout(reject, 4500);
      });
      const newSample: TestSample = {
        id: `snap_${Date.now()}`,
        name: `Foto Câmera (${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`,
        type: "image",
        url: snapUrl,
        badge: "CAM 2 · Ao Vivo",
      };
      setCustomSamples((prev) => [newSample, ...prev]);
      setSelectedSampleId(newSample.id);
    } catch {
      setSelectedSampleId("cam2_real");
    } finally {
      setSnapshotLoading(false);
    }
  };

  const handleUploadCustomImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const newSample: TestSample = {
      id: `upload_${Date.now()}`,
      name: file.name.slice(0, 16),
      type: "image",
      url,
      badge: "Foto Enviada",
    };
    setCustomSamples((prev) => [newSample, ...prev]);
    setSelectedSampleId(newSample.id);
  };

  // Carregamento resiliente do modelo TensorFlow COCO-SSD no início
  useEffect(() => {
    let isMounted = true;
    const loadModel = async () => {
      if (cocoModelRef.current) return;
      setModelLoading(true);

      let tries = 0;
      while (!(window as any).cocoSsd && tries < 35) {
        await new Promise((r) => setTimeout(r, 200));
        tries++;
      }

      const coco = (window as any).cocoSsd;
      if (coco && !cocoModelRef.current) {
        try {
          const model = await coco.load({ base: "mobilenet_v2" });
          if (isMounted) {
            cocoModelRef.current = model;
            setModelReady(true);
            setModelLoading(false);
            console.log("[Vigia IA] ✅ COCO-SSD pronto para inferência real!");
          }
        } catch (err) {
          console.warn("[Vigia IA] Erro ao carregar COCO-SSD:", err);
          if (isMounted) setModelLoading(false);
        }
      } else {
        if (isMounted) setModelLoading(false);
      }
    };

    loadModel();
    return () => {
      isMounted = false;
    };
  }, []);

  // Loop de Detecção de IA 100% Real (Analisa Imagens ou Vídeos através da Rede Neural)
  useEffect(() => {
    if (!testMode) {
      setActiveDetection(null);
      loiteringStartRef.current = null;
      setLoiterDisplay("00:00");
      return;
    }

    let isMounted = true;
    let animId: number | null = null;
    let timerInterval: NodeJS.Timeout | null = null;
    let lastInferTime = 0;

    const allowedMap: Record<string, string> = {
      person: "Pessoas",
      car: "Carros",
      truck: "Carros",
      bus: "Carros",
      motorcycle: "Motos",
      bicycle: "Motos",
      dog: "Animais",
      cat: "Animais",
    };

    const analyzeElement = async (elem: HTMLImageElement | HTMLVideoElement) => {
      if (!cocoModelRef.current) return;

      const width = (elem as any).videoWidth || (elem as any).naturalWidth || 640;
      const height = (elem as any).videoHeight || (elem as any).naturalHeight || 360;
      if (width === 0 || height === 0) return;

      const scaleX = 600 / width;
      const scaleY = 360 / height;

      try {
        const predictions = await cocoModelRef.current.detect(elem);
        const minScore = sensitivity / 100;
        let bestInsideTarget: any = null;

        for (const pred of predictions) {
          const category = allowedMap[pred.class];
          if (!category || !classes.includes(category)) continue;

          const [bx, by, bw, bh] = pred.bbox;
          const targetX = bx * scaleX;
          const targetY = by * scaleY;
          const targetW = bw * scaleX;
          const targetH = bh * scaleY;

          const centerX = targetX + targetW / 2;
          const feetY = targetY + targetH;
          const centerY = targetY + targetH / 2;

          const isInside =
            isPointInPoly({ x: centerX, y: feetY }, points) ||
            isPointInPoly({ x: centerX, y: centerY }, points);

          const conf = Math.round(pred.score * 100);
          const passesSensitivity = pred.score >= minScore;

          if (isInside) {
            bestInsideTarget = {
              pred,
              conf,
              passesSensitivity,
              bbox: { x: targetX, y: targetY, w: targetW, h: targetH },
              targetClass:
                pred.class === "person"
                  ? "Pessoa"
                  : pred.class === "car"
                    ? "Carro"
                    : pred.class === "motorcycle"
                      ? "Moto"
                      : pred.class,
            };
            break;
          }
        }

        if (bestInsideTarget) {
          if (bestInsideTarget.passesSensitivity) {
            if (!loiteringStartRef.current) {
              loiteringStartRef.current = Date.now();
            }
            const elapsed = (Date.now() - loiteringStartRef.current) / 1000;

            setActiveDetection({
              targetClass: bestInsideTarget.targetClass,
              confidence: bestInsideTarget.conf,
              duration: elapsed,
              bbox: bestInsideTarget.bbox,
              camId: "cam2",
            });

            setLoiterDisplay(`00:${String(Math.floor(elapsed)).padStart(2, "0")}`);

            if (
              elapsed >= loiterSeconds &&
              Date.now() - lastAlarmRef.current > 12000
            ) {
              lastAlarmRef.current = Date.now();
              playAlarmSound();
              const newAlert: AlertEvent = {
                id: String(Date.now()),
                targetClass: bestInsideTarget.targetClass,
                timeFormatted: new Date().toLocaleTimeString("pt-BR"),
                durationFormatted: `00:${String(Math.round(elapsed)).padStart(2, "0")}`,
                confidence: bestInsideTarget.conf,
                camId: "cam2",
                thumbnailUrl: currentSample.url,
                timestamp: new Date().toISOString(),
              };
              setAlerts((prev) => [newAlert, ...prev.slice(0, 9)]);
              if (tuyaConfig.enabled) handleTestTuya();
            }
          } else {
            // Alvo dentro da cerca mas sensibilidade configurada é mais alta que a confiança
            loiteringStartRef.current = null;
            setLoiterDisplay("00:00");
            setActiveDetection({
              targetClass: `${bestInsideTarget.targetClass} (${bestInsideTarget.conf}% < Sens. ${sensitivity}%)`,
              confidence: bestInsideTarget.conf,
              duration: 0,
              bbox: bestInsideTarget.bbox,
              camId: "cam2",
            });
          }
        } else {
          // Nenhum alvo real detectado dentro da cerca
          loiteringStartRef.current = null;
          setActiveDetection(null);
          setLoiterDisplay("00:00");
        }
      } catch (err) {
        console.warn("[Vigia IA] Erro na inferência:", err);
      }
    };

    if (currentSample.type === "image") {
      const runImage = () => {
        const img = imageRef.current;
        if (img && img.complete && img.naturalWidth > 0) {
          analyzeElement(img);
        }
      };
      runImage();
      timerInterval = setInterval(runImage, 1000);
      return () => {
        isMounted = false;
        if (timerInterval) clearInterval(timerInterval);
        setActiveDetection(null);
        loiteringStartRef.current = null;
      };
    } else {
      const stepVideo = () => {
        if (!isMounted || !testMode) return;
        const vid = videoRef.current;
        if (vid && !vid.paused && !vid.ended && vid.readyState >= 2) {
          const now = performance.now();
          if (now - lastInferTime > 250) {
            lastInferTime = now;
            analyzeElement(vid);
          }
        }
        animId = requestAnimationFrame(stepVideo);
      };
      stepVideo();
      return () => {
        isMounted = false;
        if (animId) cancelAnimationFrame(animId);
        setActiveDetection(null);
        loiteringStartRef.current = null;
      };
    }
  }, [
    testMode,
    selectedSampleId,
    modelReady,
    classes,
    sensitivity,
    loiterSeconds,
    points,
    tuyaConfig.enabled,
  ]);

  // Drag & drop suave dos vértices (Mouse e Touch)
  useEffect(() => {
    if (activeVertex === null || !isEditing) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!svgRef.current) return;
      const clientX =
        "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY =
        "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const scaleX = 600 / rect.width;
      const scaleY = 360 / rect.height;

      const rawX = Math.round((clientX - rect.left) * scaleX);
      const rawY = Math.round((clientY - rect.top) * scaleY);

      const clampedX = Math.max(5, Math.min(595, rawX));
      const clampedY = Math.max(5, Math.min(355, rawY));

      setPoints((prev) => {
        const updated = [...prev];
        updated[activeVertex] = { x: clampedX, y: clampedY };
        return updated;
      });
    };

    const handlePointerUp = () => {
      setActiveVertex(null);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchmove", handlePointerMove, { passive: false });
    window.addEventListener("touchend", handlePointerUp);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("touchend", handlePointerUp);
    };
  }, [activeVertex, isEditing]);

  const handleApplyPreset = (
    key: keyof typeof PRESET_FENCES,
    label: string,
  ) => {
    setPoints(PRESET_FENCES[key]);
    setFenceName(label);
    setShowPresets(false);
  };

  const syncAiSetting = async (payload: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/ia/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      window.dispatchEvent(new CustomEvent("cftv-vigia-updated"));
      return res;
    } catch {
      return null;
    }
  };

  const handleToggleWindowsNotify = async (enabled: boolean) => {
    setWindowsNotify(enabled);
    await syncAiSetting({ windowsNotify: enabled });
  };

  const handleSaveFence = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsEditing(false);
    setActiveVertex(null);
    setFenceSaved(true);

    try {
      localStorage.setItem("cctv_fence_points", JSON.stringify(points));
      localStorage.setItem("cctv_fence_name", fenceName);
    } catch (err) {}

    await syncAiSetting({
      fenceName,
      fencePoints: points,
    });

    setTimeout(() => setFenceSaved(false), 2500);
  };

  const toggleClass = (c: string) => {
    const updated = classes.includes(c)
      ? classes.filter((x) => x !== c)
      : [...classes, c];
    setClasses(updated);

    const classMapping: Record<string, string> = {
      Pessoas: "person",
      Carros: "car",
      Motos: "motorcycle",
      Animais: "animal",
    };
    syncAiSetting({
      enabledClasses: updated.map((name) => classMapping[name] || "person"),
    });
  };

  const handleSensitivityChange = (val: number) => {
    setSensitivity(val);
    syncAiSetting({ confidence: val });
  };

  const handleLoiterChange = (val: number) => {
    setLoiterSeconds(val);
    syncAiSetting({ durationSeconds: val });
  };

  // Converte o prazo retornado pelo servidor (TV Box) para o relógio local do navegador,
  // evitando falso "Expirado" caso haja diferença de horário entre TV Box e PC/Celular.
  const computeLocalVigiaDeadline = (settings: {
    masterVigia?: boolean;
    remainingSeconds?: number | null;
    vigiaActiveUntil?: number | null;
    serverTime?: number;
  }): number | null => {
    if (!settings.masterVigia) return null;
    if (settings.remainingSeconds !== undefined && settings.remainingSeconds !== null) {
      return Date.now() + Math.max(0, Number(settings.remainingSeconds)) * 1000;
    }
    if (settings.vigiaActiveUntil && settings.serverTime) {
      const remainingMs = Math.max(0, Number(settings.vigiaActiveUntil) - Number(settings.serverTime));
      return Date.now() + remainingMs;
    }
    return settings.vigiaActiveUntil || null;
  };

  const handleToggleVigia = async (enable: boolean, hours?: number) => {
    const targetHours = hours !== undefined ? hours : vigiaDurationHours;
    setMasterVigia(enable);
    if (hours !== undefined) setVigiaDurationHours(targetHours);
    setVigiaActiveUntil(
      enable && targetHours > 0
        ? Date.now() + Math.round(targetHours * 3600 * 1000)
        : null,
    );

    try {
      const res = await fetch("/api/ia/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterVigia: enable,
          vigiaDurationHours: targetHours,
        }),
      });
      const data = await res.json();
      if (data.success && data.settings) {
        const enabled = Boolean(data.settings.masterVigia);
        setMasterVigia(enabled);
        setVigiaActiveUntil(enabled ? computeLocalVigiaDeadline(data.settings) : null);
        if (data.settings.vigiaDurationHours !== undefined) {
          setVigiaDurationHours(Number(data.settings.vigiaDurationHours));
        }
        window.dispatchEvent(new CustomEvent("cftv-vigia-updated"));
      }
    } catch (e) {
      console.warn("[Vigia] Falha ao sincronizar com servidor:", e);
    }
  };

  const handleSaveWebhook = (url: string) => {
    setWebhookUrl(url);
    fetch("/api/ia/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl: url.trim() }),
    }).catch(() => {});
  };

  const handleTestSiren = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    setSirenTesting(true);

    // Reproduz imediatamente a sirene no alto-falante
    playAlarmSound(true);

    setActiveDetection({
      targetClass: "Pessoa",
      confidence: 96,
      duration: 5,
      camId: "cam2",
    });

    try {
      await fetch("/api/ia/alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camId: "cam2",
          targetClass: "person",
          duration: 5,
          force: true,
        }),
      });
    } catch (e) {}

    setTimeout(() => setSirenTesting(false), 1600);
    setTimeout(() => setActiveDetection(null), 6000);
  };

  const handleTestWebhook = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    const target = webhookUrl.trim();
    if (!target) {
      setWebhookFeedback("⚠️ Digite uma URL de Webhook antes de testar!");
      setTimeout(() => setWebhookFeedback(null), 4000);
      return;
    }

    setWebhookTesting(true);
    setWebhookFeedback("Enviando requisição...");

    setActiveDetection({
      targetClass: "Carro",
      confidence: 91,
      duration: 4,
      camId: "cam2",
    });

    try {
      const res = await fetch("/api/ia/trigger-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: target,
          eventName: "Teste Cerca Virtual",
          targetClass: "car",
          duration: 4,
          camId: "cam2",
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setWebhookFeedback(`✓ Sucesso! Webhook recebeu HTTP ${data.status || 200}`);
      } else {
        setWebhookFeedback(`⚠️ ${data.error || "Falha na entrega do webhook"}`);
      }
    } catch (err: any) {
      setWebhookFeedback(`⚠️ Erro de rede: ${err.message}`);
    }

    setTimeout(() => setWebhookTesting(false), 1600);
    setTimeout(() => setActiveDetection(null), 6000);
    setTimeout(() => setWebhookFeedback(null), 5500);
  };

  const camName = cameras.cam2?.name
    ? `CAM 2 (${cameras.cam2.name})`
    : "Portão principal";
  const polygonPointsStr = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="view">
      <PageTitle
        eyebrow="PROCESSAMENTO LOCAL"
        title="Vigia IA & Cerca Virtual"
        description="Detecção inteligente e cerca virtual interativa com automação Smart Life / Tuya."
        action={
          <div className="segmented">
            <button
              className={!testMode ? "active" : ""}
              onClick={() => setTestMode(false)}
            >
              Feed ao vivo
            </button>
            <button
              className={testMode ? "active" : ""}
              onClick={() => setTestMode(true)}
            >
              Teste de Sensibilidade
            </button>
          </div>
        }
      />

      <div className="ai-layout">
        <div>
          {/* Seletor de Cenários e Imagens de Teste da Câmera */}
          {testMode && (
            <div className="flex flex-wrap items-center gap-1.5 p-2 bg-[#0c1012] border border-[#232b2f] rounded-lg mb-2.5">
              <span className="text-[11px] font-bold text-lime-400 uppercase tracking-wider mr-1 flex items-center gap-1">
                <span>📸</span> Cenários de Teste:
              </span>
              {allSamples.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => setSelectedSampleId(sample.id)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    selectedSampleId === sample.id
                      ? "bg-lime-400 text-black shadow-md font-bold"
                      : "bg-[#141a1d] text-neutral-300 hover:bg-[#1e262a] border border-[#273136]"
                  }`}
                >
                  <span>{sample.type === "video" ? "🎬" : "📸"}</span>
                  <span>{sample.name}</span>
                </button>
              ))}

              <button
                type="button"
                onClick={handleCaptureLiveSnapshot}
                disabled={snapshotLoading}
                className="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 flex items-center gap-1 transition-all"
                title="Captura uma foto instantânea em alta definição direto da CAM 2 para testar"
              >
                <span>⚡</span>
                <span>{snapshotLoading ? "Capturando..." : "Foto da Câmera Agora"}</span>
              </button>

              <label className="px-2 py-1 rounded text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 cursor-pointer flex items-center gap-1 transition-all">
                <span>📁</span>
                <span>Subir Foto</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadCustomImage}
                  className="hidden"
                />
              </label>
            </div>
          )}

          <div className="relative">
            {testMode ? (
              <div className="camera-card relative">
                {currentSample.type === "video" ? (
                  <video
                    ref={videoRef}
                    src={currentSample.url}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img
                    ref={imageRef}
                    src={currentSample.url}
                    alt={currentSample.name}
                    crossOrigin="anonymous"
                    className="w-full h-full object-cover"
                  />
                )}
                <div className="camera-shade" />
                <div className="camera-top">
                  <div>
                    <span className="status-pill warn">
                      <i /> TESTE LOCAL
                    </span>
                    <span className="camera-name">
                      {currentSample.name} ({currentSample.badge})
                    </span>
                    {modelLoading ? (
                      <span className="status-pill warn animate-pulse">
                        <i /> CARREGANDO IA...
                      </span>
                    ) : modelReady ? (
                      <span className="status-pill ok">
                        <i /> IA PRONTA
                      </span>
                    ) : null}
                  </div>
                  <span className="telemetry">
                    SENSIBILIDADE: {sensitivity}% · PERMANÊNCIA: {loiterSeconds}s
                  </span>
                </div>
              </div>
            ) : (
              <CCTVPlayerFeed
                camId="cam2"
                name={camName}
                index={0}
                ai={false}
              />
            )}

            {/* Overlays Dinâmicos de Detecção (Apenas visíveis quando há detecção ativa ou disparo de teste) */}
            {activeDetection && (
              <>
                <div
                  className={`detect-box ${activeDetection.targetClass.toLowerCase().includes("car") ? "car" : "person"} pointer-events-none animate-pulse`}
                  style={{
                    zIndex: 25,
                    ...(activeDetection.bbox
                      ? {
                          left: `${(activeDetection.bbox.x / 600) * 100}%`,
                          top: `${(activeDetection.bbox.y / 360) * 100}%`,
                          width: `${(activeDetection.bbox.w / 600) * 100}%`,
                          height: `${(activeDetection.bbox.h / 360) * 100}%`,
                        }
                      : {}),
                  }}
                >
                  <span>
                    {activeDetection.targetClass.toUpperCase()}&nbsp;{" "}
                    {activeDetection.confidence}%
                  </span>
                </div>

                <div
                  className="loiter pointer-events-none"
                  style={{ zIndex: 25 }}
                >
                  <Icon name="alert" size={14} />
                  <span>PERMANÊNCIA</span>
                  <strong>{loiterDisplay}</strong>
                </div>
              </>
            )}

            {/* Cerca Virtual Interativa com Suporte a Drag & Drop Real */}
            <svg
              ref={svgRef}
              className="fence select-none"
              viewBox="0 0 600 360"
              preserveAspectRatio="none"
              style={{
                zIndex: isEditing ? 35 : 10,
                pointerEvents: isEditing ? "auto" : "none",
              }}
            >
              <polygon
                points={polygonPointsStr}
                style={{
                  fill: isEditing
                    ? "rgba(197, 243, 106, 0.28)"
                    : "rgba(197, 243, 106, 0.12)",
                  stroke: "#c5f36a",
                  strokeWidth: isEditing ? 2.5 : 2,
                  strokeDasharray: isEditing ? "5 3" : "7 5",
                  pointerEvents: "none",
                }}
              />

              {/* Vértices arrastáveis exibidos durante a edição */}
              {isEditing &&
                points.map((p, idx) => {
                  const isThisActive = activeVertex === idx;
                  return (
                    <g
                      key={idx}
                      className="cursor-pointer"
                      style={{ pointerEvents: "auto" }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveVertex(idx);
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        setActiveVertex(idx);
                      }}
                    >
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="18"
                        className="fill-lime-400/25 stroke-lime-400 stroke-2 hover:fill-lime-400/50 transition-all cursor-grab active:cursor-grabbing"
                        style={{
                          transformOrigin: `${p.x}px ${p.y}px`,
                          transform: isThisActive ? "scale(1.3)" : "scale(1)",
                        }}
                      />
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="5"
                        className="fill-[#101416] stroke-lime-400 stroke-1 pointer-events-none"
                      />
                      <text
                        x={p.x}
                        y={p.y - 14}
                        textAnchor="middle"
                        className="fill-lime-400 text-xs font-mono font-bold pointer-events-none select-none"
                      >
                        P{idx + 1}
                      </text>
                    </g>
                  );
                })}
            </svg>

            {isEditing && (
              <div className="absolute top-14 left-4 z-40 px-3 py-1.5 rounded-md bg-black/90 border border-lime-400 text-lime-400 text-xs font-mono flex items-center gap-2 backdrop-blur-md shadow-2xl">
                <span className="w-2 h-2 rounded-full bg-lime-400 animate-ping" />
                MODO DE EDIÇÃO ATIVO: Arraste os círculos P1 a P{points.length}{" "}
                para delimitar a área
              </div>
            )}
          </div>

          {/* Barra de Ferramentas da Cerca */}
          <div className="fence-tools">
            <span>
              <Icon name="scan" />
              Cerca ativa: <b>{fenceName}</b>
            </span>

            {isEditing ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="bg-lime-400 text-black font-bold border-lime-400 hover:bg-lime-300 transition-colors"
                  onClick={handleSaveFence}
                >
                  <Icon name="check" size={13} />
                  Salvar Vértices
                </button>
                <button
                  type="button"
                  className="text-neutral-400 hover:text-white"
                  onClick={(e) => {
                    e.preventDefault();
                    setIsEditing(false);
                    setActiveVertex(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="relative flex items-center gap-2">
                <button
                  type="button"
                  className={
                    fenceSaved ? "border-lime-400 text-lime-400 font-bold" : ""
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    setIsEditing(true);
                  }}
                >
                  {fenceSaved ? "✓ Salvo!" : "Editar vértices"}
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setShowPresets(!showPresets);
                    }}
                  >
                    Modelos de área ▾
                  </button>

                  {showPresets && (
                    <div className="absolute right-0 bottom-full mb-2 w-48 bg-[#111618] border border-[#30383b] rounded-lg shadow-2xl p-1 z-50 flex flex-col text-xs text-left">
                      <button
                        type="button"
                        className="px-3 py-2 hover:bg-[#1f272a] rounded text-left text-neutral-200"
                        onClick={() =>
                          handleApplyPreset("portao", "Portão & Calçada")
                        }
                      >
                        🚪 Portão & Calçada
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 hover:bg-[#1f272a] rounded text-left text-neutral-200"
                        onClick={() =>
                          handleApplyPreset("garagem", "Garagem Completa")
                        }
                      >
                        🚗 Garagem Completa
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 hover:bg-[#1f272a] rounded text-left text-neutral-200"
                        onClick={() =>
                          handleApplyPreset("calcada", "Passagem / Calçada")
                        }
                      >
                        🚶 Faixa de Passagem
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 hover:bg-[#1f272a] rounded text-left text-neutral-200"
                        onClick={() =>
                          handleApplyPreset("total", "Monitoramento Total")
                        }
                      >
                        📐 Quadro Total
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="panel ai-controls space-y-4">
          <div className="panel-title">
            <div>
              <span className="pulse-dot" />
              <h3>Motor IA ativo</h3>
            </div>
            <span>18 ms</span>
          </div>

          {/* MODO ENCOMENDA / VIGIA TEMPORÁRIO (SOB DEMANDA ATÉ 12H) */}
          <div className="bg-[#121719] p-3 rounded-lg border border-[#252c30] space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">📦</span>
                <div>
                  <h4 className="text-xs font-bold text-white">Modo Encomenda / Vigia</h4>
                  <p className="text-[10px] text-neutral-400">
                    {masterVigia ? (
                      <span className="text-lime-400 font-medium">
                        🟢 {vigiaTimeRemaining || "Monitorando portão"}
                      </span>
                    ) : (
                      "⚪ Em repouso econômico"
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={`switch shrink-0 ${masterVigia ? "on" : ""}`}
                onClick={() => handleToggleVigia(!masterVigia)}
                title="Ativar/desativar monitoramento temporário"
              >
                <i />
              </button>
            </div>

            <div>
              <div className="flex justify-between items-center text-[11px] text-neutral-400 mb-1.5">
                <span>Janela de espera:</span>
                <span className="text-lime-400 font-mono font-bold">
                  {vigiaDurationHours === 0 ? "Sem limite" : (vigiaDurationHours === 0.5 ? "30 min" : `${vigiaDurationHours}h`)}
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 text-[11px]">
                {[
                  { label: "30m", val: 0.5 },
                  { label: "1h", val: 1 },
                  { label: "2h", val: 2 },
                  { label: "4h", val: 4 },
                  { label: "8h", val: 8 },
                  { label: "12h", val: 12 },
                  { label: "∞", val: 0 },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleToggleVigia(true, item.val)}
                    className={`py-1 px-1 rounded text-center transition-colors font-mono ${
                      vigiaDurationHours === item.val
                        ? "bg-lime-400 text-black font-bold shadow-sm"
                        : "bg-[#1b2226] text-neutral-300 hover:bg-[#252f35]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-400 font-medium mb-1 block">
              Classes monitoradas
            </label>
            <div className="chips">
              {["Pessoas", "Carros", "Motos", "Animais"].map((c) => (
                <button
                  key={c}
                  onClick={() => toggleClass(c)}
                  className={classes.includes(c) ? "selected" : ""}
                >
                  <i />
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-neutral-400">Sensibilidade</span>
              <b className="text-lime-400 font-mono">{sensitivity}%</b>
            </div>
            <input
              type="range"
              min="30"
              max="95"
              value={sensitivity}
              onChange={(e) => handleSensitivityChange(Number(e.target.value))}
            />
          </div>

          <div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-neutral-400">Tempo de permanência na cerca</span>
              <b className="text-lime-400 font-mono">{loiterSeconds} s</b>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={loiterSeconds}
              onChange={(e) => handleLoiterChange(Number(e.target.value))}
            />
            <div className="flex justify-between text-[11px] text-neutral-500 mt-1">
              <span>1s (Imediato)</span>
              <span>5s (Padrão)</span>
              <span>10s (Espera)</span>
            </div>
          </div>

          {/* MÓDULO DE NOTIFICAÇÕES (WINDOWS & ANDROID) */}
          <NotificationChannelsCard
            windowsNotify={windowsNotify}
            onToggleWindowsNotify={handleToggleWindowsNotify}
          />

          {/* MÓDULO SMART LIFE / TUYA INTEGRADO NO PADRÃO COMMAND CENTER */}
          <div className="pt-3 border-t border-[#252c30]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-lime-400 tracking-wide flex items-center gap-1.5">
                  <span className="text-sm">⚡</span> Smart Life / Tuya
                </span>
                <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-lime-400/15 text-lime-400 border border-lime-400/30">
                  {tuyaConfig.enabled ? "ATIVO" : "PAUSADO"}
                </span>
              </div>
              <button
                className={`switch ${tuyaConfig.enabled ? "on" : ""}`}
                onClick={() => handleToggleTuya(!tuyaConfig.enabled)}
                title="Ativar/desativar disparo do Smart Life"
              >
                <i />
              </button>
            </div>

            {tuyaConfig.enabled && (
              <div className="space-y-2 mt-2 bg-[#121719] p-2.5 rounded-lg border border-[#252c30] text-xs">
                {/* Segmented Device vs Scene */}
                <div className="segmented full">
                  <button
                    className={
                      tuyaConfig.actionType === "device" ? "active" : ""
                    }
                    onClick={() => handleChangeTuyaActionType("device")}
                  >
                    Aparelho Direto
                  </button>
                  <button
                    className={
                      tuyaConfig.actionType === "scene" ? "active" : ""
                    }
                    onClick={() => handleChangeTuyaActionType("scene")}
                  >
                    Cena Smart Life
                  </button>
                </div>

                {tuyaConfig.actionType === "device" ? (
                  <div>
                    <div className="flex justify-between items-center mb-1 text-xs text-neutral-400">
                      <span>Aparelho a acionar:</span>
                      <button
                        onClick={loadTuyaDevices}
                        disabled={tuyaLoading}
                        className="text-lime-400 hover:underline"
                      >
                        {tuyaLoading ? "..." : "🔄 Atualizar"}
                      </button>
                    </div>
                    <select
                      className="w-full text-xs"
                      value={tuyaConfig.targetId}
                      onChange={(e) => handleSelectDevice(e.target.value)}
                    >
                      {tuyaDevices.length === 0 ? (
                        <option value={tuyaConfig.targetId}>
                          {tuyaConfig.targetName || "Tomadinha"}
                        </option>
                      ) : (
                        tuyaDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} {d.online === false ? "(Offline)" : ""}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                ) : (
                  <div>
                    <div className="flex justify-between items-center mb-1 text-xs text-neutral-400">
                      <span>Cena a executar:</span>
                      <button
                        onClick={loadTuyaScenes}
                        className="text-lime-400 hover:underline"
                      >
                        🔄 Atualizar
                      </button>
                    </div>
                    <select
                      className="w-full text-xs"
                      value={tuyaConfig.sceneId}
                      onChange={(e) => handleSelectScene(e.target.value)}
                    >
                      {tuyaScenes.length === 0 ? (
                        <option value="">
                          {tuyaConfig.sceneName || "Nenhuma cena carregada"}
                        </option>
                      ) : (
                        tuyaScenes.map((s) => (
                          <option key={s.scene_id} value={s.scene_id}>
                            {s.scene_name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                )}

                {/* Botão de teste Tuya */}
                <button
                  onClick={handleTestTuya}
                  disabled={tuyaTesting}
                  className="w-full py-2 rounded bg-lime-400/20 text-lime-400 hover:bg-lime-400/30 font-bold border border-lime-400/40 text-xs flex items-center justify-center gap-1.5 transition-all"
                >
                  <span>⚡</span>
                  {tuyaTesting
                    ? "Disparando Tuya..."
                    : "Testar Ação Smart Life"}
                </button>

                {tuyaFeedback && (
                  <p className="text-xs text-center text-lime-400 font-mono animate-fade">
                    {tuyaFeedback}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Seção de Automação de Webhook */}
          <div className="pt-2 border-t border-[#252c30]">
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
                <Icon name="webhook" size={14} className="text-lime-400" /> Webhook de Alerta (HTTP POST)
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                  webhookUrl
                    ? "bg-lime-400/15 text-lime-400 border border-lime-400/30"
                    : "bg-neutral-800 text-neutral-400"
                }`}
              >
                {webhookUrl ? "ATIVO" : "NÃO CONFIGURADO"}
              </span>
            </div>

            <div className="space-y-2 bg-[#121719] p-2.5 rounded-lg border border-[#252c30] text-xs">
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">
                  URL de Destino do Webhook:
                </label>
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => handleSaveWebhook(e.target.value)}
                  placeholder="http://192.168.1.50:1880/cftv/alerta"
                  className="w-full px-2.5 py-1.5 bg-[#0b0e10] border border-[#2c3539] rounded text-neutral-200 font-mono text-xs focus:border-lime-400 focus:outline-none"
                />
              </div>

              {/* Presets Rápidos */}
              <div>
                <span className="text-[10px] text-neutral-400 block mb-1">
                  Atalhos rápidos:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      handleSaveWebhook("http://localhost:1880/cftv/alerta")
                    }
                    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-300 border border-neutral-700 transition-colors"
                    title="Node-RED local"
                  >
                    Node-RED
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleSaveWebhook(
                        "http://homeassistant.local:8123/api/webhook/cftv_alerta",
                      )
                    }
                    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-300 border border-neutral-700 transition-colors"
                    title="Home Assistant Webhook"
                  >
                    Home Assistant
                  </button>
                  {webhookUrl && (
                    <button
                      type="button"
                      onClick={() => handleSaveWebhook("")}
                      className="px-1.5 py-0.5 rounded bg-neutral-900 hover:bg-red-950/40 text-[11px] text-red-400 border border-neutral-800 transition-colors"
                      title="Limpar URL"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>

              {webhookFeedback && (
                <p className="text-xs text-center text-lime-400 font-mono animate-fade pt-1">
                  {webhookFeedback}
                </p>
              )}
            </div>
          </div>

          <div className="dual-actions pt-2">
            <button
              type="button"
              onClick={handleTestSiren}
              disabled={sirenTesting}
            >
              <Icon name="siren" />
              {sirenTesting ? "Disparando..." : "Testar sirene"}
            </button>
            <button
              type="button"
              onClick={handleTestWebhook}
              disabled={webhookTesting}
            >
              <Icon name="webhook" />
              {webhookTesting ? "Enviando..." : "Testar Webhook"}
            </button>
          </div>
        </aside>
      </div>

      <div className="section-head">
        <div>
          <h2>Histórico de alertas em tempo real</h2>
          <span>Últimas detecções registradas na cerca virtual</span>
        </div>
      </div>

      <div className="alerts">
        {alerts.map((a) => (
          <div className="alert-row" key={a.id}>
            <img
              src={a.thumbnailUrl}
              alt="Miniatura do alerta"
              onError={(e) => {
                e.currentTarget.src = "/samples/carro_portao.jpg";
              }}
            />
            <div className="alert-type">
              <i />
              <div>
                <b>{a.targetClass}</b>
                <span>{a.timeFormatted}</span>
              </div>
            </div>
            <div>
              <span>PERMANÊNCIA</span>
              <b>{a.durationFormatted}</b>
            </div>
            <span className="confidence">{a.confidence}% precisão</span>
            <button
              onClick={() =>
                alert(
                  `Evento ${a.id} (${a.targetClass}) gravado às ${a.timeFormatted}`,
                )
              }
            >
              <Icon name="play" size={14} />
              Ver evento
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
