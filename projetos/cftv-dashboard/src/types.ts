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
