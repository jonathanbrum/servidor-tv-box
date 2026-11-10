/**
 * Player Inteligente de Vídeo CFTV: Suporta WebSocket com JSMpeg ou Streaming Direto de Quadros JPEG.
 */
class CCTVPlayer {
  constructor(options) {
    this.camId = options.camId;
    this.name = options.name;
    this.canvasId = (options.canvas && options.canvas.id) || (this.camId === 'cam1' ? 'canvasCam1' : 'canvasCam2');
    this.container = (options.canvas && options.canvas.parentElement) || document.getElementById(this.camId === 'cam1' ? 'boxCam1' : 'boxCam2');
    this.canvas = options.canvas;
    this.ctx = null;
    this.statusDot = options.statusDot;
    this.statusBadge = options.statusBadge;
    this.fpsCounter = options.fpsCounter;
    this.latencyCounter = options.latencyCounter;
    this.statusOverlay = options.statusOverlay;
    this.statusOverlayTitle = options.statusOverlayTitle;
    this.statusOverlayDesc = options.statusOverlayDesc;
    this.statusOverlayIcon = options.statusOverlayIcon;
    this.flashElement = options.flashElement;
    this.subtypeBadge = options.subtypeBadge;

    this.subtype = 0;
    this.quality = options.quality || localStorage.getItem('cctv_quality') || 'hd';
    this.zoomLevel = 1.0;
    this.reconnectTimer = null;
    this.reconnectDelay = 4000;
    this.checkSocketTimer = null;
    this.isManualStop = false;
    this.activeWs = null;
    this.ws = null;
    this.jsmpegPlayer = null;
    this.fps = 0;
    this.framesDecoded = 0;
    this.lastFpsCalc = performance.now();
    this.fpsInterval = null;
    this.isDestroyed = false;
    this.hasActiveFeed = false;

    this.initFpsTracker();
    this.start();
  }

  getWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/stream/${this.camId}?subtype=${this.subtype}&quality=${this.quality}`;
  }

  setStatus(state, desc = '') {
    if (this.isDestroyed) return;

    if (this.hasActiveFeed && state === 'reconnecting') {
      return; // Mantém a visualização viva durante reconexões secundárias
    }

    if (this.statusDot) {
      this.statusDot.className = `status-dot ${state}`;
    }

    if (this.statusBadge) {
      this.statusBadge.className = `badge-status-text ${state}`;
      this.statusBadge.textContent = state === 'online' ? 'Ao Vivo' : (state === 'reconnecting' ? 'Reconectando' : 'Offline');
    }

    if (this.statusOverlay) {
      if (state === 'online') {
        this.statusOverlay.classList.add('hidden');
      } else {
        this.statusOverlay.classList.remove('hidden');
        if (this.statusOverlayTitle) {
          this.statusOverlayTitle.textContent = state === 'reconnecting' ? 'Reconectando à Câmera...' : 'Câmera Indisponível';
        }
        if (this.statusOverlayDesc && desc) {
          this.statusOverlayDesc.textContent = desc;
        }
        if (this.statusOverlayIcon) {
          this.statusOverlayIcon.className = `status-overlay-icon ${state === 'reconnecting' ? 'loading' : 'offline'}`;
        }
      }
    }
  }

  initFpsTracker() {
    this.fpsInterval = setInterval(() => {
      const now = performance.now();
      const deltaSec = (now - this.lastFpsCalc) / 1000;
      this.fps = Math.round(this.framesDecoded / deltaSec);
      this.framesDecoded = 0;
      this.lastFpsCalc = now;

      if (this.fpsCounter) {
        const qualityTag = this.quality === 'sd' ? '540p' : '1080p';
        this.fpsCounter.textContent = `${qualityTag} • ${this.fps} FPS`;
      }
    }, 1000);
  }

  /**
   * Garante que o elemento Canvas esteja sempre presente no DOM no container correto
   * Resolve o bug onde o WebGLRenderer.prototype.destroy() do JSMpeg remove o elemento do DOM.
   */
  ensureCanvas() {
    if (!this.container) {
      this.container = document.getElementById(this.camId === 'cam1' ? 'boxCam1' : 'boxCam2') 
        || (this.canvas && this.canvas.parentElement);
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.remove();
    }

    if (this.container) {
      const oldCanvas = this.container.querySelector(`#${this.canvasId}`) || this.container.querySelector('canvas.cam-canvas');
      if (oldCanvas) {
        oldCanvas.remove();
      }

      const fresh = document.createElement('canvas');
      fresh.id = this.canvasId;
      fresh.className = 'cam-canvas';
      this.container.insertBefore(fresh, this.container.firstChild);
      this.canvas = fresh;
    }

    this.ctx = null;
    this.applyZoom();
    return this.canvas;
  }

  /**
   * Renderiza um quadro binário JPEG diretamente sobre o Canvas com aceleração de hardware
   */
  async renderJpegFrame(blobOrBuffer) {
    if (!this.canvas) return;
    if (!this.ctx) {
      this.ctx = this.canvas.getContext('2d');
    }
    if (!this.ctx) return;

    try {
      const blob = blobOrBuffer instanceof Blob ? blobOrBuffer : new Blob([blobOrBuffer], { type: 'image/jpeg' });
      const isSd = this.quality === 'sd';
      const targetWidth = isSd ? 960 : 1920;
      const targetHeight = isSd ? 540 : 1080;

      if (window.createImageBitmap) {
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: targetWidth,
          resizeHeight: targetHeight,
          resizeQuality: isSd ? 'low' : 'high'
        });
        if (this.canvas.width !== targetWidth) {
          this.canvas.width = targetWidth;
          this.canvas.height = targetHeight;
        }
        this.ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
        bitmap.close();
      } else {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          this.canvas.width = targetWidth;
          this.canvas.height = targetHeight;
          this.ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }

      this.hasActiveFeed = true;
      this.framesDecoded++;
      this.setStatus('online');
    } catch (e) {
      console.warn('[CCTVPlayer] Erro ao renderizar quadro:', e.message);
    }
  }

  /**
   * Conecta ao túnel de vídeo em tempo real (JSMpeg / WebSocket)
   */
  start() {
    this.stop();
    this.isManualStop = false;
    this.setStatus('reconnecting', `Carregando stream ${this.quality.toUpperCase()}...`);

    // Assegura canvas virgem no DOM para contexto WebGL limpo
    this.ensureCanvas();

    const wsUrl = this.getWsUrl();
    console.log(`[CCTVPlayer] Iniciando JSMpeg Player para ${this.name} (${this.quality.toUpperCase()}): ${wsUrl}`);

    try {
      if (window.JSMpeg && window.JSMpeg.Player) {
        this.jsmpegPlayer = new window.JSMpeg.Player(wsUrl, {
          canvas: this.canvas,
          audio: false,
          autoplay: true,
          pauseWhenHidden: false,
          disableGl: false,
          videoBufferSize: 256 * 1024,
          onVideoDecode: () => {
            this.framesDecoded++;
            if (!this.hasActiveFeed) {
              this.hasActiveFeed = true;
              this.setStatus('online');
            }
          }
        });

        // Fast-forward em tempo real: se acumular dados no buffer (ex: lag momentâneo), decodifica em loop até zerar
        if (this.jsmpegPlayer && typeof this.jsmpegPlayer.updateForStreaming === 'function') {
          this.jsmpegPlayer.updateForStreaming = () => {
            if (this.jsmpegPlayer.video) {
              let loops = 0;
              while (
                loops < 5 &&
                this.jsmpegPlayer.video.bits &&
                (this.jsmpegPlayer.video.bits.byteLength - (this.jsmpegPlayer.video.bits.index >> 3)) > 35000
              ) {
                if (!this.jsmpegPlayer.video.decode()) break;
                loops++;
              }
              this.jsmpegPlayer.video.decode();
            }
          };
        }

        // Ao alternar abas, reconecta instantaneamente ao retornar para sincronizar com o relógio real
        if (!this.visibilityAttached) {
          this.visibilityAttached = true;
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isDestroyed && !this.isManualStop) {
              this.start();
            }
          });
        }

        // Monitora o socket do JSMpeg para reconexão apenas em caso de perda de rede inesperada
        if (this.checkSocketTimer) clearInterval(this.checkSocketTimer);
        this.checkSocketTimer = setInterval(() => {
          if (this.jsmpegPlayer && this.jsmpegPlayer.source && this.jsmpegPlayer.source.socket) {
            clearInterval(this.checkSocketTimer);
            this.checkSocketTimer = null;
            const currentWs = this.jsmpegPlayer.source.socket;
            this.activeWs = currentWs;
            currentWs.addEventListener('close', () => {
              if (this.activeWs === currentWs && !this.isDestroyed && !this.isManualStop) {
                this.scheduleReconnect('Conexão reiniciada.');
              }
            });
          }
        }, 150);
      } else {
        this.startFallbackWs(wsUrl);
      }
    } catch (err) {
      console.warn(`[CCTVPlayer] Falha ao iniciar JSMpeg para ${this.name}, iniciando fallback:`, err.message);
      this.startFallbackWs(wsUrl);
    }
  }

  startFallbackWs(wsUrl) {
    const currentWs = new WebSocket(wsUrl);
    this.ws = currentWs;
    this.activeWs = currentWs;
    currentWs.binaryType = 'arraybuffer';
    currentWs.onmessage = async (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);
      if (data.length < 4) return;
      if (data[0] === 0xff && data[1] === 0xd8) {
        await this.renderJpegFrame(data);
      }
    };
    currentWs.onerror = () => {
      if (this.activeWs === currentWs && !this.isManualStop && !this.isDestroyed) {
        this.scheduleReconnect('Erro de rede');
      }
    };
    currentWs.onclose = () => {
      if (this.activeWs === currentWs && !this.isManualStop && !this.isDestroyed) {
        this.scheduleReconnect('Conexão encerrada');
      }
    };
  }

  scheduleReconnect(reason = '') {
    if (this.isDestroyed || this.isManualStop) return;
    this.setStatus('reconnecting', `${reason} Reconectando em 4s...`);

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isDestroyed && !this.isManualStop) {
        this.start();
      }
    }, this.reconnectDelay);
  }

  stop() {
    this.isManualStop = true;
    this.activeWs = null;
    if (this.checkSocketTimer) {
      clearInterval(this.checkSocketTimer);
      this.checkSocketTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.jsmpegPlayer) {
      try {
        this.jsmpegPlayer.destroy();
      } catch (e) {}
      this.jsmpegPlayer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.hasActiveFeed = false;
  }

  toggleSubtype() {
    const nextQuality = this.quality === 'hd' ? 'sd' : 'hd';
    this.setQuality(nextQuality);
  }

  setQuality(quality) {
    if (this.quality === quality && this.hasActiveFeed) return;
    this.quality = quality;
    this.subtype = quality === 'hd' ? 0 : 1;
    if (this.subtypeBadge) {
      this.subtypeBadge.textContent = quality === 'hd' ? 'HD (1080P)' : 'SD (480P)';
    }
    if (this.fpsCounter) {
      const qualityTag = quality === 'sd' ? '540p' : '1080p';
      this.fpsCounter.textContent = `${qualityTag} • Carregando...`;
    }
    this.start();
  }

  zoomIn() {
    this.zoomLevel = Math.min(3.0, this.zoomLevel + 0.25);
    this.applyZoom();
  }

  zoomOut() {
    this.zoomLevel = Math.max(1.0, this.zoomLevel - 0.25);
    this.applyZoom();
  }

  resetZoom() {
    this.zoomLevel = 1.0;
    this.applyZoom();
  }

  applyZoom() {
    if (this.canvas) {
      this.canvas.style.transform = `scale(${this.zoomLevel})`;
    }
  }

  takeSnapshot() {
    if (!this.canvas) return;

    if (this.flashElement) {
      this.flashElement.classList.add('active');
      setTimeout(() => this.flashElement.classList.remove('active'), 120);
    }

    try {
      const dataUrl = this.canvas.toDataURL('image/png');
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `snapshot_${this.camId}_${this.name.toLowerCase()}_${timestamp}.png`;

      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('[CCTVPlayer] Erro ao salvar snapshot:', err);
    }
  }

  destroy() {
    this.isDestroyed = true;
    this.stop();
    if (this.fpsInterval) clearInterval(this.fpsInterval);
  }
}

window.CCTVPlayer = CCTVPlayer;
