export type IconName =
  | 'grid'
  | 'wall'
  | 'ai'
  | 'record'
  | 'network'
  | 'settings'
  | 'bell'
  | 'camera'
  | 'maximize'
  | 'plus'
  | 'minus'
  | 'refresh'
  | 'play'
  | 'pause'
  | 'download'
  | 'scan'
  | 'wifi'
  | 'check'
  | 'alert'
  | 'chevron'
  | 'calendar'
  | 'filter'
  | 'siren'
  | 'webhook'
  | 'menu'
  | 'shield';

export interface CameraInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  rtspUrlMasked?: string;
  description?: string;
  connected?: boolean;
  latency?: number;
  fps?: number;
}

export interface SystemStatus {
  cam1?: {
    connected: boolean;
    lastCheck: string;
    latency: number;
    clients: number;
  };
  cam2?: {
    connected: boolean;
    lastCheck: string;
    latency: number;
    clients: number;
  };
}

export interface AiSettings {
  masterVigia: boolean;
  vigiaDurationHours?: number;
  vigiaActiveUntil?: number | null;
  camId: string;
  sourceType: string;
  sourceTitle: string;
  roi: { x: number; y: number; w: number; h: number };
  durationSeconds: number;
  confidence: number;
  enabledClasses: string[];
  soundAlert: boolean;
  windowsNotify: boolean;
  webhookUrl: string;
  fenceName?: string;
  fencePoints?: Array<{ x: number; y: number }>;
  remainingSeconds?: number | null;
  serverTime?: number;
  // Calibração Dinâmica de Movimento & Presença
  motionAutoCalibrate?: boolean;
  motionMinThreshold?: number; // Piso mínimo (ex: 1.5%)
  motionMaxThreshold?: number; // Teto máximo (ex: 15.0%)
  motionMarginOffset?: number; // Margem acima do ruído (ex: 0.8%)
  motionSampleSize?: number; // Quantidade de picos na memória (ex: 10)
  motionSampleWindowMinutes?: number; // Janela de validade dos picos (ex: 30)
  motionDecayMinutes?: number; // Minutos sem movimento para decair ao piso (ex: 5)
  trackingHoldSeconds?: number; // Segundos de persistência da IA para pessoa parada (ex: 10)
}

export interface NotifyConfig {
  platform: string;
  cooldownSeconds: number;
  windowsToastSupported: boolean;
  windowsToastEnabled: boolean;
  windowsToastAttachPhoto: boolean;
  ntfyEnabled: boolean;
  ntfyServer: string;
  ntfyTopic: string;
  ntfyAttachPhoto: boolean;
  telegramEnabled: boolean;
  hasTelegramToken: boolean;
  telegramBotTokenMasked: string;
  telegramChatId: string;
  telegramAttachPhoto: boolean;
}

export interface VigiaDetection {
  targetClass: string;
  rawClass?: string;
  confidence: number;
  duration: number;
  camId?: string;
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface VigiaStatus {
  enabled: boolean;
  stage: 'idle' | 'watching' | 'loading-model' | 'filtered' | 'detected' | 'error';
  modelLoaded: boolean;
  modelLoading: boolean;
  motionPct: number;
  motionThresholdPct?: number; // Limiar dinâmico ativo calculado pela calibração
  motionBaselinePct?: number; // Ruído de fundo estimado
  isTracking?: boolean; // Se está no modo de acompanhamento de presença (pessoa imóvel)
  lastCheckAt: string | null;
  lastInferenceMs: number | null;
  detection: VigiaDetection | null;
  message: string;
}

export interface RecordingItem {
  id?: string;
  camId: string;
  fileName: string;
  startTime: string;
  endTime: string;
  duration: string;
  type: 'Movimento' | 'Contínua';
  status: 'Disponível';
}

export interface AlertEvent {
  id: string;
  targetClass: string;
  timeFormatted: string;
  durationFormatted: string;
  confidence: number;
  camId: string;
  thumbnailUrl: string;
  timestamp: string;
}
