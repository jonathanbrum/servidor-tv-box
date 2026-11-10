/**
 * Aplicação Principal da Central de Monitoramento CFTV
 */
document.addEventListener('DOMContentLoaded', () => {
  // Inicialização do relógio OSD no cabeçalho
  const clockElement = document.getElementById('liveClock');
  const osdDate1 = document.getElementById('osdDate1');
  const osdDate2 = document.getElementById('osdDate2');

  function updateClock() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const fullStr = `${dateStr} ${timeStr}`;

    if (clockElement) clockElement.textContent = fullStr;
    if (osdDate1) osdDate1.textContent = fullStr;
    if (osdDate2) osdDate2.textContent = fullStr;
  }
  updateClock();
  setInterval(updateClock, 1000);

  // Carrega configurações dinâmicas vindas das variáveis de ambiente (.env)
  async function loadServerConfig() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return;
      const data = await res.json();

      const c1 = data.cameras.cam1;
      const c2 = data.cameras.cam2;

      // Câmera 1 (Fundos)
      const camNameCam1 = document.getElementById('camNameCam1');
      const camMetaCam1 = document.getElementById('camMetaCam1');
      const osdRecCam1 = document.getElementById('osdRecCam1');
      const diagNameCam1 = document.getElementById('diagNameCam1');
      const diagIpCam1 = document.getElementById('diagIpCam1');
      const diagPortCam1 = document.getElementById('diagPortCam1');

      if (camNameCam1) camNameCam1.textContent = `CAM 01 — ${c1.name.toUpperCase()}`;
      if (camMetaCam1) camMetaCam1.textContent = `${c1.description} • ${c1.host}:${c1.port}`;
      if (osdRecCam1) osdRecCam1.textContent = c1.name;
      if (diagNameCam1) diagNameCam1.textContent = `CAM 1 (${c1.name})`;
      if (diagIpCam1) diagIpCam1.textContent = c1.host;
      if (diagPortCam1) diagPortCam1.textContent = c1.port;

      // Câmera 2 (Entrada)
      const camNameCam2 = document.getElementById('camNameCam2');
      const camMetaCam2 = document.getElementById('camMetaCam2');
      const osdRecCam2 = document.getElementById('osdRecCam2');
      const diagNameCam2 = document.getElementById('diagNameCam2');
      const diagIpCam2 = document.getElementById('diagIpCam2');
      const diagPortCam2 = document.getElementById('diagPortCam2');

      if (camNameCam2) camNameCam2.textContent = `CAM 02 — ${c2.name.toUpperCase()}`;
      if (camMetaCam2) camMetaCam2.textContent = `${c2.description} • ${c2.host}:${c2.port}`;
      if (osdRecCam2) osdRecCam2.textContent = c2.name;
      if (diagNameCam2) diagNameCam2.textContent = `CAM 2 (${c2.name})`;
      if (diagIpCam2) diagIpCam2.textContent = c2.host;
      if (diagPortCam2) diagPortCam2.textContent = c2.port;

      // Rodapé
      const footerPort = document.getElementById('footerPort');
      const footerWifi = document.getElementById('footerWifi');
      if (footerPort && data.port) footerPort.textContent = `PORTA: ${data.port}`;
      if (footerWifi) {
        if (data.primaryIp && data.primaryIp !== 'localhost') {
          footerWifi.textContent = `ACESSO WI-FI: http://${data.primaryIp}:${data.port || 3333}`;
        } else {
          footerWifi.textContent = `ACESSO LOCAL: http://localhost:${data.port || 3333}`;
        }
      }

      // Atualiza nomes nos players
      playerCam1.name = c1.name;
      playerCam2.name = c2.name;

    } catch (err) {
      console.warn('[App] Erro ao carregar configurações dinâmicas:', err);
    }
  }

  // Instanciação dos Players das Câmeras
  const playerCam1 = new CCTVPlayer({
    camId: 'cam1',
    name: 'Fundos',
    canvas: document.getElementById('canvasCam1'),
    statusDot: document.getElementById('dotCam1'),
    statusBadge: document.getElementById('badgeStatusCam1'),
    fpsCounter: document.getElementById('fpsCam1'),
    latencyCounter: document.getElementById('latencyCam1'),
    statusOverlay: document.getElementById('overlayCam1'),
    statusOverlayTitle: document.getElementById('overlayTitleCam1'),
    statusOverlayDesc: document.getElementById('overlayDescCam1'),
    statusOverlayIcon: document.getElementById('overlayIconCam1'),
    flashElement: document.getElementById('flashCam1'),
    subtypeBadge: document.getElementById('subtypeBadgeCam1')
  });

  const playerCam2 = new CCTVPlayer({
    camId: 'cam2',
    name: 'Entrada',
    canvas: document.getElementById('canvasCam2'),
    statusDot: document.getElementById('dotCam2'),
    statusBadge: document.getElementById('badgeStatusCam2'),
    fpsCounter: document.getElementById('fpsCam2'),
    latencyCounter: document.getElementById('latencyCam2'),
    statusOverlay: document.getElementById('overlayCam2'),
    statusOverlayTitle: document.getElementById('overlayTitleCam2'),
    statusOverlayDesc: document.getElementById('overlayDescCam2'),
    statusOverlayIcon: document.getElementById('overlayIconCam2'),
    flashElement: document.getElementById('flashCam2'),
    subtypeBadge: document.getElementById('subtypeBadgeCam2')
  });

  window.playerCam1 = playerCam1;
  window.playerCam2 = playerCam2;

  // Carrega os textos vindos das variáveis de ambiente
  loadServerConfig();

  // Controles da Câmera 1
  document.getElementById('btnSnapshotCam1')?.addEventListener('click', () => playerCam1.takeSnapshot());
  document.getElementById('btnRetryCam1')?.addEventListener('click', () => playerCam1.start());
  document.getElementById('subtypeBadgeCam1')?.addEventListener('click', () => playerCam1.toggleSubtype());
  document.getElementById('btnZoomInCam1')?.addEventListener('click', () => playerCam1.zoomIn());
  document.getElementById('btnZoomOutCam1')?.addEventListener('click', () => playerCam1.zoomOut());
  document.getElementById('btnZoomResetCam1')?.addEventListener('click', () => playerCam1.resetZoom());

  // Controles da Câmera 2
  document.getElementById('btnSnapshotCam2')?.addEventListener('click', () => playerCam2.takeSnapshot());
  document.getElementById('btnRetryCam2')?.addEventListener('click', () => playerCam2.start());
  document.getElementById('subtypeBadgeCam2')?.addEventListener('click', () => playerCam2.toggleSubtype());
  document.getElementById('btnZoomInCam2')?.addEventListener('click', () => playerCam2.zoomIn());
  document.getElementById('btnZoomOutCam2')?.addEventListener('click', () => playerCam2.zoomOut());
  document.getElementById('btnZoomResetCam2')?.addEventListener('click', () => playerCam2.resetZoom());

  // Fullscreen Individual da Câmera 1 (Botão e Duplo Clique)
  const cardCam1 = document.getElementById('cardCam1');
  const viewportCam1 = document.getElementById('viewportCam1');
  const btnFsCam1 = document.getElementById('btnFsCam1');

  const toggleFsCam1 = () => toggleElementFullscreen(cardCam1);
  btnFsCam1?.addEventListener('click', toggleFsCam1);
  viewportCam1?.addEventListener('dblclick', toggleFsCam1);

  // Fullscreen Individual da Câmera 2 (Botão e Duplo Clique)
  const cardCam2 = document.getElementById('cardCam2');
  const viewportCam2 = document.getElementById('viewportCam2');
  const btnFsCam2 = document.getElementById('btnFsCam2');

  const toggleFsCam2 = () => toggleElementFullscreen(cardCam2);
  btnFsCam2?.addEventListener('click', toggleFsCam2);
  viewportCam2?.addEventListener('dblclick', toggleFsCam2);

  // Fullscreen Global do Grid
  const btnGridFullscreen = document.getElementById('btnGridFullscreen');
  btnGridFullscreen?.addEventListener('click', () => {
    toggleElementFullscreen(document.documentElement);
  });

  function toggleElementFullscreen(element) {
    if (!document.fullscreenElement) {
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  // MODAL DE DIAGNÓSTICO E TOPOLOGIA
  const modalDiag = document.getElementById('modalDiagnostics');
  const btnOpenDiag = document.getElementById('btnDiagnostics');
  const btnCloseDiag = document.getElementById('btnCloseDiag');
  const btnRefreshDiag = document.getElementById('btnRefreshDiag');

  btnOpenDiag?.addEventListener('click', () => {
    modalDiag.classList.add('active');
    fetchDiagnostics();
  });

  btnCloseDiag?.addEventListener('click', () => {
    modalDiag.classList.remove('active');
  });

  modalDiag?.addEventListener('click', (e) => {
    if (e.target === modalDiag) {
      modalDiag.classList.remove('active');
    }
  });

  btnRefreshDiag?.addEventListener('click', async () => {
    btnRefreshDiag.textContent = 'Verificando...';
    try {
      await fetch('/api/check', { method: 'POST' });
      await fetchDiagnostics();
    } finally {
      btnRefreshDiag.textContent = '🔄 Re-testar Portas Agora';
    }
  });

  // Polling periódico do status no backend
  async function fetchDiagnostics() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();

      // Câmera 1
      const c1 = data.cameras.cam1;
      const diagStatusCam1 = document.getElementById('diagStatusCam1');
      const diagLatencyCam1 = document.getElementById('diagLatencyCam1');
      const latencyCam1 = document.getElementById('latencyCam1');

      if (diagStatusCam1) {
        diagStatusCam1.innerHTML = c1.tcpReachable 
          ? `<span style="color:#10b981">🟢 Porta ${c1.port} Conectada</span>` 
          : '<span style="color:#ef4444">🔴 Inacessível (' + (c1.lastError || 'timeout') + ')</span>';
      }
      if (diagLatencyCam1) {
        diagLatencyCam1.textContent = c1.latencyMs ? `${c1.latencyMs} ms` : '--';
      }
      if (latencyCam1 && c1.latencyMs) {
        latencyCam1.textContent = `${c1.latencyMs}ms`;
      }

      // Câmera 2
      const c2 = data.cameras.cam2;
      const diagStatusCam2 = document.getElementById('diagStatusCam2');
      const diagLatencyCam2 = document.getElementById('diagLatencyCam2');
      const latencyCam2 = document.getElementById('latencyCam2');

      if (diagStatusCam2) {
        diagStatusCam2.innerHTML = c2.tcpReachable 
          ? `<span style="color:#10b981">🟢 Porta ${c2.port} Conectada</span>` 
          : '<span style="color:#ef4444">🔴 Inacessível (' + (c2.lastError || 'timeout') + ')</span>';
      }
      if (diagLatencyCam2) {
        diagLatencyCam2.textContent = c2.latencyMs ? `${c2.latencyMs} ms` : '--';
      }
      if (latencyCam2 && c2.latencyMs) {
        latencyCam2.textContent = `${c2.latencyMs}ms`;
      }

      // Se a Câmera 2 estiver offline por causa do roteador 2, exibe descrição no overlay
      if (!c2.tcpReachable && playerCam2.statusBadge.classList.contains('reconnecting')) {
        playerCam2.statusOverlayDesc.textContent = 'A Câmera 2 está no Roteador 2. Se o roteador bloquear o tráfego, configure o Port Forwarding da porta 554 no menu do Roteador 2.';
      }

    } catch (err) {
      console.warn('[App] Erro ao buscar status:', err);
    }
  }

  // Executa consulta inicial e a cada 5 segundos
  fetchDiagnostics();
  setInterval(fetchDiagnostics, 5000);

  // ==========================================================================
  // CONTROLE DO MODO SMART TV / WALLBOARD
  // ==========================================================================
  const btnTvMode = document.getElementById('btnTvMode');
  const btnExitTv = document.getElementById('btnExitTv');
  const cctvGrid = document.querySelector('.cctv-grid');
  let tvInactivityTimer = null;
  let wakeLockSentinel = null;

  function showTvToast(message) {
    const existing = document.querySelector('.tv-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'tv-toast';
    toast.innerHTML = `<span>📺</span> <span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ==========================================================================
  // RECEPTOR DE ALERTAS DE IA / CERCA VIRTUAL EM TEMPO REAL (SMART TV & DESKTOP)
  // ==========================================================================
  let tvAlertAudioContext = null;
  let tvAlarmTimeout = null;

  function playTvAlarmChime() {
    try {
      if (!tvAlertAudioContext) {
        tvAlertAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (tvAlertAudioContext.state === 'suspended') {
        tvAlertAudioContext.resume();
      }
      const now = tvAlertAudioContext.currentTime;
      const playTone = (freq, start, duration) => {
        const osc = tvAlertAudioContext.createOscillator();
        const gain = tvAlertAudioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0.35, now + start);
        gain.gain.exponentialRampToValueAtTime(0.01, now + start + duration);
        osc.connect(gain);
        gain.connect(tvAlertAudioContext.destination);
        osc.start(now + start);
        osc.stop(now + start + duration);
      };

      // Sequência dupla de chamada forte
      playTone(784.00, 0, 0.28);   // G5
      playTone(587.33, 0.28, 0.45); // D5
      playTone(784.00, 0.75, 0.28);
      playTone(1046.50, 1.03, 0.65); // C6
    } catch (e) {
      console.warn('[TV Alarme] Áudio bloqueado ou não suportado:', e);
    }
  }

  function showTvAlarmBanner(message) {
    const existing = document.querySelector('.tv-alarm-toast');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'tv-alarm-toast';
    banner.innerHTML = `<span>🚨</span> <span>${message}</span>`;
    document.body.appendChild(banner);

    setTimeout(() => {
      banner.remove();
    }, 12000);
  }

  function handleIncomingIaAlert(data) {
    console.log('[TV Alert] Alerta recebido via SSE:', data);
    if (data.type !== 'alarm') return;

    const targetLabel = data.targetClass === 'person' ? 'PESSOA' : (data.targetClass === 'car' ? 'CARRO' : 'VEÍCULO');
    const targetCamId = data.camId || 'cam2';
    const duration = parseFloat(data.duration || 5).toFixed(1);

    // 1. Toca som alto nos alto-falantes da TV
    playTvAlarmChime();

    // 2. Exibe Banner Gigante na TV
    showTvAlarmBanner(`ATENÇÃO: ${targetLabel} DETECTADA PARADA NO PORTÃO (> ${duration}s)!`);

    // 3. Destaca a Câmera afetada com Borda Vermelha Pulsante
    const card = document.getElementById(targetCamId === 'cam1' ? 'cardCam1' : 'cardCam2');
    if (card) {
      card.classList.add('cam-alarm-active');
      clearTimeout(tvAlarmTimeout);
      tvAlarmTimeout = setTimeout(() => {
        card.classList.remove('cam-alarm-active');
      }, 15000);
    }

    // 4. Se estiver em Modo TV e em tela dividida, auto-foca temporariamente na câmera da entrada!
    if (document.body.classList.contains('tv-mode')) {
      const prevFocusCam1 = cctvGrid?.classList.contains('focus-cam1');
      const prevFocusCam2 = cctvGrid?.classList.contains('focus-cam2');

      if (!prevFocusCam1 && !prevFocusCam2) {
        cctvGrid?.classList.add(targetCamId === 'cam1' ? 'focus-cam1' : 'focus-cam2');
        updateTvButtons();
        setTimeout(() => {
          // Retorna para visualização dupla após 15 segundos
          cctvGrid?.classList.remove('focus-cam1', 'focus-cam2');
          updateTvButtons();
        }, 15000);
      }
    }
  }

  function initIaEventStream() {
    try {
      const eventSource = new EventSource('/api/ia/events');
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleIncomingIaAlert(data);
        } catch (e) {}
      };
      eventSource.onerror = () => {
        // EventSource nativo reconecta automaticamente
      };
    } catch (err) {
      console.warn('[TV Alarme] EventSource não suportado:', err);
    }
  }

  initIaEventStream();

  // ==========================================================================
  // MOTOR DE INTELIGÊNCIA ARTIFICIAL DIRETO NO MODO TV & DASHBOARD
  // ==========================================================================
  const btnTvIa = document.getElementById('btnTvIa');
  const btnHeaderIa = document.getElementById('btnHeaderIa');
  const labelHeaderIa = document.getElementById('labelHeaderIa');
  let isIaEngineActive = false;
  let cocoModel = null;
  let iaLoopTimer = null;
  let iaConfig = null;
  let loiteringTimerStart = null;
  let lastDashboardAlarm = 0;

  async function loadIaConfig() {
    try {
      const res = await fetch('/api/ia/settings');
      if (res.ok) {
        iaConfig = await res.json();
      }
    } catch (e) {}
    if (!iaConfig) {
      iaConfig = {
        roi: { x: 0.15, y: 0.20, w: 0.70, h: 0.65 },
        durationSeconds: 5.0,
        confidence: 55,
        enabledClasses: ['person', 'car', 'motorcycle'],
        camId: 'cam2'
      };
    }
  }

  function updateIaUiState(active) {
    if (btnTvIa) {
      btnTvIa.textContent = active ? '🤖 Vigia IA: LIGADO' : '🤖 Vigia IA: Desligado';
      btnTvIa.classList.toggle('active', active);
      btnTvIa.style.borderColor = active ? '#10b981' : 'rgba(0, 243, 255, 0.4)';
      btnTvIa.style.color = active ? '#34d399' : '#00f3ff';
    }
    if (labelHeaderIa) {
      labelHeaderIa.textContent = active ? 'Vigia IA: LIGADO' : 'Vigia IA: Desligado';
    }
    if (btnHeaderIa) {
      btnHeaderIa.classList.toggle('active', active);
      btnHeaderIa.style.borderColor = active ? '#10b981' : 'rgba(0, 243, 255, 0.4)';
      btnHeaderIa.style.color = active ? '#34d399' : '#00f3ff';
    }
  }

  async function toggleModoIa() {
    isIaEngineActive = !isIaEngineActive;
    updateIaUiState(isIaEngineActive);

    if (isIaEngineActive) {
      showTvToast('🤖 Modo IA Ativado: Monitorando cerca virtual (> 5s)');
      await startIaEngine();
    } else {
      showTvToast('Modo IA Desativado');
      stopIaEngine();
    }
  }

  async function startIaEngine() {
    stopIaEngine();
    await loadIaConfig();

    if (!cocoModel && window.cocoSsd) {
      showTvToast('Carregando Modelo IA...');
      try {
        cocoModel = await cocoSsd.load({ base: 'mobilenet_v2' });
        showTvToast('✅ IA Pronta no Modo TV');
      } catch (err) {
        console.error('[IA Dashboard] Falha ao carregar modelo:', err);
        showTvToast('❌ Erro ao carregar IA');
        isIaEngineActive = false;
        updateIaUiState(false);
        return;
      }
    }

    runIaLoop();
  }

  function stopIaEngine() {
    if (iaLoopTimer) {
      clearTimeout(iaLoopTimer);
      iaLoopTimer = null;
    }
    loiteringTimerStart = null;

    // Limpa overlay canvas
    const overlay1 = document.getElementById('aiOverlayCam1');
    const overlay2 = document.getElementById('aiOverlayCam2');
    if (overlay1) overlay1.getContext('2d')?.clearRect(0, 0, overlay1.width, overlay1.height);
    if (overlay2) overlay2.getContext('2d')?.clearRect(0, 0, overlay2.width, overlay2.height);
  }

  async function runIaLoop() {
    if (!isIaEngineActive || !cocoModel) return;

    // Câmera alvo (padrão cam2 - Entrada)
    const targetCam = (iaConfig && iaConfig.camId) || 'cam2';
    const videoCanvas = document.getElementById(targetCam === 'cam1' ? 'canvasCam1' : 'canvasCam2');
    const overlayCanvas = document.getElementById(targetCam === 'cam1' ? 'aiOverlayCam1' : 'aiOverlayCam2');

    if (videoCanvas && overlayCanvas && videoCanvas.width > 50 && videoCanvas.height > 50) {
      overlayCanvas.width = videoCanvas.width;
      overlayCanvas.height = videoCanvas.height;
      const ctx = overlayCanvas.getContext('2d');
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      try {
        const predictions = await cocoModel.detect(videoCanvas);
        const minConf = (iaConfig.confidence || 55) / 100;
        const enabled = new Set(iaConfig.enabledClasses || ['person', 'car', 'motorcycle']);

        const valid = predictions.filter(p => enabled.has(p.class) && p.score >= minConf);

        // Converte ROI da Cerca Virtual para pixels
        const roi = iaConfig.roi || { x: 0.15, y: 0.20, w: 0.70, h: 0.65 };
        const rx = roi.x * overlayCanvas.width;
        const ry = roi.y * overlayCanvas.height;
        const rw = roi.w * overlayCanvas.width;
        const rh = roi.h * overlayCanvas.height;

        let targetInside = null;
        valid.forEach(p => {
          const [bx, by, bw, bh] = p.bbox;
          const cx = bx + bw / 2;
          const cy = by + bh / 2;
          const feetY = by + bh;

          const inside = (cx >= rx && cx <= rx + rw && feetY >= ry && feetY <= ry + rh + 20) ||
                         (cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh);

          if (inside && !targetInside) {
            targetInside = p;
          }

          // Desenha caixa do objeto no overlay da TV
          ctx.strokeStyle = p.class === 'person' ? '#00f3ff' : '#a855f7';
          ctx.lineWidth = 3;
          ctx.strokeRect(bx, by, bw, bh);

          ctx.fillStyle = p.class === 'person' ? '#00f3ff' : '#a855f7';
          ctx.font = 'bold 13px sans-serif';
          ctx.fillText(`${p.class.toUpperCase()} ${Math.round(p.score * 100)}%`, bx + 4, Math.max(14, by - 4));
        });

        const maxDuration = iaConfig.durationSeconds || 5.0;
        let isAlarm = false;

        if (targetInside) {
          if (!loiteringTimerStart) loiteringTimerStart = Date.now();
          const elapsed = (Date.now() - loiteringTimerStart) / 1000;

          if (elapsed >= maxDuration) {
            isAlarm = true;
            const now = Date.now();
            if (now - lastDashboardAlarm > 25000) {
              lastDashboardAlarm = now;
              // Dispara alarme visual, som da TV e webhook
              handleIncomingIaAlert({
                type: 'alarm',
                camId: targetCam,
                targetClass: targetInside.class,
                duration: elapsed
              });

              // Avisa webhook da campainha se configurado
              if (iaConfig.webhookUrl) {
                fetch('/api/ia/trigger-webhook', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    url: iaConfig.webhookUrl,
                    eventName: 'loitering_alert',
                    camId: targetCam,
                    targetClass: targetInside.class,
                    duration: elapsed
                  })
                }).catch(() => {});
              }
            }
          }

          // Desenha cerca virtual com contagem de tempo
          ctx.save();
          ctx.strokeStyle = isAlarm ? '#ef4444' : '#f59e0b';
          ctx.fillStyle = isAlarm ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.15)';
          ctx.lineWidth = 3;
          ctx.setLineDash([10, 5]);
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.setLineDash([]);

          ctx.fillStyle = isAlarm ? '#ef4444' : '#f59e0b';
          ctx.font = 'bold 14px monospace';
          const txt = isAlarm ? '🚨 ALARME: PERMANÊNCIA > 5s!' : `⚠️ ALVO PARADO: ${elapsed.toFixed(1)}s / ${maxDuration.toFixed(1)}s`;
          ctx.fillText(txt, rx + 10, Math.max(18, ry - 6));
          ctx.restore();

        } else {
          if (loiteringTimerStart && (Date.now() - loiteringTimerStart > 1200)) {
            loiteringTimerStart = null;
          }
          // Desenha cerca virtual calma em ciano
          ctx.save();
          ctx.strokeStyle = 'rgba(0, 243, 255, 0.7)';
          ctx.fillStyle = 'rgba(0, 243, 255, 0.06)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.setLineDash([]);
          ctx.fillStyle = '#00f3ff';
          ctx.font = 'bold 12px monospace';
          ctx.fillText('🛡️ CERCA VIRTUAL ATIVA', rx + 8, Math.max(16, ry - 5));
          ctx.restore();
        }

      } catch (err) {
        console.warn('[IA Dashboard] Erro no frame:', err);
      }
    }

    // Próxima análise em 800ms (~1.2 FPS, leve na CPU da TV)
    if (isIaEngineActive) {
      iaLoopTimer = setTimeout(runIaLoop, 800);
    }
  }

  btnTvIa?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleModoIa();
  });
  btnHeaderIa?.addEventListener('click', () => toggleModoIa());

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        console.log('[TV] WakeLock ativado: a tela da TV não irá desligar');
      }
    } catch (e) {
      console.log('[TV] WakeLock não suportado ou bloqueado:', e);
    }
  }

  function releaseWakeLock() {
    if (wakeLockSentinel) {
      wakeLockSentinel.release().catch(() => {});
      wakeLockSentinel = null;
    }
  }

  function setTvMode(enable, autoFullscreen = true) {
    if (enable) {
      document.body.classList.add('tv-mode');
      localStorage.setItem('cctv_tv_mode', 'true');
      showTvToast('Modo TV Ativado • Pressione 1 (Fundos), 2 (Entrada) ou 0 (Ambas) • Esc para sair');
      requestWakeLock();
      resetTvInactivity();

      if (autoFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      document.body.classList.remove('tv-mode', 'controls-visible', 'hide-cursor');
      // Mantém a câmera escolhida pelo usuário mesmo ao sair do modo TV
      setActiveCameraView(currentCameraView, false);
      localStorage.setItem('cctv_tv_mode', 'false');
      releaseWakeLock();
      clearTimeout(tvInactivityTimer);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  function resetTvInactivity() {
    if (!document.body.classList.contains('tv-mode')) return;

    document.body.classList.add('controls-visible');
    document.body.classList.remove('hide-cursor');

    clearTimeout(tvInactivityTimer);
    tvInactivityTimer = setTimeout(() => {
      if (document.body.classList.contains('tv-mode')) {
        document.body.classList.remove('controls-visible');
        document.body.classList.add('hide-cursor');
      }
    }, 3500);
  }

  let lastMouseMoveTime = 0;
  function handleThrottledActivity() {
    const now = Date.now();
    if (now - lastMouseMoveTime < 250) return;
    lastMouseMoveTime = now;
    resetTvInactivity();
  }

  window.addEventListener('mousemove', handleThrottledActivity, { passive: true });
  window.addEventListener('keydown', handleThrottledActivity, { passive: true });

  const btnTvCam1 = document.getElementById('btnTvCam1');
  const btnTvCam2 = document.getElementById('btnTvCam2');
  const btnTvSplit = document.getElementById('btnTvSplit');
  const btnTvFit = document.getElementById('btnTvFit');
  const btnViewCam2 = document.getElementById('btnViewCam2');
  const btnViewCam1 = document.getElementById('btnViewCam1');
  const btnViewBoth = document.getElementById('btnViewBoth');

  // ==========================================================================
  // CONTROLE UNIFICADO DE CÂMERA ATIVA (SÓ CAM 2 / SÓ CAM 1 / 2 CÂMERAS)
  // Persiste a escolha do usuário e desliga o stream inativo para economizar CPU e rede
  // ==========================================================================
  let currentCameraView = localStorage.getItem('cctv_active_camera_view') || 'cam2';

  function setActiveCameraView(view, save = true) {
    currentCameraView = view;
    if (save) {
      localStorage.setItem('cctv_active_camera_view', view);
    }

    // 1. Atualiza classes do grid (funciona no modo normal e no Modo TV)
    cctvGrid?.classList.remove('focus-cam1', 'focus-cam2');
    if (view === 'cam1') {
      cctvGrid?.classList.add('focus-cam1');
    } else if (view === 'cam2') {
      cctvGrid?.classList.add('focus-cam2');
    }

    // 2. Atualiza botões do cabeçalho
    btnViewCam2?.classList.toggle('active', view === 'cam2');
    btnViewCam1?.classList.toggle('active', view === 'cam1');
    btnViewBoth?.classList.toggle('active', view === 'both');

    // 3. Atualiza botões da barra da TV
    btnTvCam1?.classList.toggle('active', view === 'cam1');
    btnTvCam2?.classList.toggle('active', view === 'cam2');
    btnTvSplit?.classList.toggle('active', view === 'both');

    // 4. Garante que os players estejam ativos
    if (view === 'cam2') {
      if (playerCam2?.isManualStop) playerCam2?.start();
    } else if (view === 'cam1') {
      if (playerCam1?.isManualStop) playerCam1?.start();
    } else {
      if (playerCam1?.isManualStop) playerCam1?.start();
      if (playerCam2?.isManualStop) playerCam2?.start();
    }
  }

  // Eventos dos botões do cabeçalho
  btnViewCam2?.addEventListener('click', () => {
    setActiveCameraView('cam2');
    showTvToast('Visualização: Só Entrada (CAM 2)');
  });

  btnViewCam1?.addEventListener('click', () => {
    setActiveCameraView('cam1');
    showTvToast('Visualização: Só Fundos (CAM 1)');
  });

  btnViewBoth?.addEventListener('click', () => {
    setActiveCameraView('both');
    showTvToast('Visualização: 2 Câmeras Lado a Lado');
  });

  // Eventos dos botões da TV
  btnTvCam1?.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveCameraView('cam1');
    showTvToast('Câmera 1 (Fundos) — Tela Cheia');
  });

  btnTvCam2?.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveCameraView('cam2');
    showTvToast('Câmera 2 (Entrada) — Tela Cheia');
  });

  btnTvSplit?.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveCameraView('both');
    showTvToast('Visualização Dupla (2 Câmeras)');
  });

  btnTvFit?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isCover = document.body.classList.toggle('tv-fit-cover');
    btnTvFit.textContent = isCover ? 'Preencher: Sim' : 'Preencher: Não';
    btnTvFit.classList.toggle('active', isCover);
    showTvToast(isCover ? 'Modo Preencher Tela: Ativado (Sem bordas pretas)' : 'Modo Proporção 16:9 Original (Sem cortes)');
  });

  btnTvMode?.addEventListener('click', () => setTvMode(true));
  btnExitTv?.addEventListener('click', () => setTvMode(false));

  // Clique em uma câmera para alternar foco rapidamente
  viewportCam1?.addEventListener('click', () => {
    if (currentCameraView === 'cam1') {
      setActiveCameraView('both');
      showTvToast('Visualização Dupla (2 Câmeras)');
    } else {
      setActiveCameraView('cam1');
      showTvToast('Câmera 1 (Fundos) — Tela Cheia');
    }
  });

  viewportCam2?.addEventListener('click', () => {
    if (currentCameraView === 'cam2') {
      setActiveCameraView('both');
      showTvToast('Visualização Dupla (2 Câmeras)');
    } else {
      setActiveCameraView('cam2');
      showTvToast('Câmera 2 (Entrada) — Tela Cheia');
    }
  });

  // CONTROLE GLOBAL DE QUALIDADE (HD / SD)
  const btnTvQuality = document.getElementById('btnTvQuality');
  const btnHeaderQuality = document.getElementById('btnHeaderQuality');
  const labelHeaderQuality = document.getElementById('labelHeaderQuality');
  let currentQuality = localStorage.getItem('cctv_quality') || 'hd';

  function updateQualityUI(quality, notify = true) {
    currentQuality = quality;
    localStorage.setItem('cctv_quality', quality);

    const isHd = quality === 'hd';
    if (btnTvQuality) {
      btnTvQuality.textContent = isHd ? 'Qualidade: HD (1080p)' : 'Qualidade: SD (480p)';
      btnTvQuality.classList.toggle('active', isHd);
    }
    if (labelHeaderQuality) {
      labelHeaderQuality.textContent = isHd ? 'Qualidade: HD (1080p)' : 'Qualidade: SD (480p)';
    }

    const b1 = document.getElementById('subtypeBadgeCam1');
    const b2 = document.getElementById('subtypeBadgeCam2');
    if (b1) b1.textContent = isHd ? 'HD (1080P)' : 'SD (480P)';
    if (b2) b2.textContent = isHd ? 'HD (1080P)' : 'SD (480P)';

    playerCam1?.setQuality(quality);
    playerCam2?.setQuality(quality);

    if (notify) {
      showTvToast(isHd ? '⚡ Modo HD Ativado (1080p Main Stream)' : '🌱 Modo SD Ativado (480p Extra Stream)');
    }
  }

  function toggleQuality() {
    const nextQuality = currentQuality === 'hd' ? 'sd' : 'hd';
    updateQualityUI(nextQuality, true);
  }

  btnTvQuality?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleQuality();
  });

  btnHeaderQuality?.addEventListener('click', () => toggleQuality());

  // Atalhos de Teclado / Controle Remoto
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (cctvGrid?.classList.contains('focus-cam1') || cctvGrid?.classList.contains('focus-cam2')) {
        cctvGrid.classList.remove('focus-cam1', 'focus-cam2');
        showTvToast('Visualização Dupla (2 Câmeras)');
        updateTvButtons();
      } else if (document.body.classList.contains('tv-mode')) {
        setTvMode(false);
      }
    } else if (e.key === 't' || e.key === 'T') {
      const isTv = document.body.classList.contains('tv-mode');
      setTvMode(!isTv);
    } else if (e.key === 'q' || e.key === 'Q') {
      toggleQuality();
    } else if (e.key === 'i' || e.key === 'I') {
      toggleModoIa();
    } else if (e.key === '1') {
      setActiveCameraView('cam1');
      showTvToast('Visualização: Câmera 1 (Fundos)');
    } else if (e.key === '2') {
      setActiveCameraView('cam2');
      showTvToast('Visualização: Câmera 2 (Entrada)');
    } else if (e.key === '0') {
      setActiveCameraView('both');
      showTvToast('Visualização Dupla (2 Câmeras)');
    }
  });

  // Inicializa qualidade salva
  updateQualityUI(currentQuality, false);

  // Inicializa visualização de câmera salva (Padrão: Só CAM 2 - Entrada)
  setActiveCameraView(currentCameraView, false);

  // Auto-iniciar em Modo TV se a URL for /tv ou contiver ?tv=1 ou se foi salvo
  const isTvRoute = window.location.pathname.includes('/tv') || 
                    window.location.search.includes('tv') || 
                    localStorage.getItem('cctv_tv_mode') === 'true';

  if (isTvRoute) {
    setTvMode(true, false);
  }

  // ==========================================================================
  // MODAL DE GRAVAÇÕES INTERNAS (CARTÃO SD) & STREAMING SOB DEMANDA
  // ==========================================================================
  const modalRecordings = document.getElementById('modalRecordings');
  const btnOpenRecordings = document.getElementById('btnRecordings');
  const btnCloseRecordings = document.getElementById('btnCloseRecordings');
  const recCamSelect = document.getElementById('recCamSelect');
  const recDateInput = document.getElementById('recDateInput');
  const btnRecToday = document.getElementById('btnRecToday');
  const btnRecYesterday = document.getElementById('btnRecYesterday');
  const btnFetchRecordings = document.getElementById('btnFetchRecordings');
  const recCountLabel = document.getElementById('recCountLabel');
  const recLoadingSpinner = document.getElementById('recLoadingSpinner');
  const recTableBody = document.getElementById('recTableBody');
  const recPlayerBox = document.getElementById('recPlayerBox');
  const recVideoTag = document.getElementById('recVideoTag');
  const recPlayerTitle = document.getElementById('recPlayerTitle');
  const recPlayerInfo = document.getElementById('recPlayerInfo');
  const btnCloseRecPlayer = document.getElementById('btnCloseRecPlayer');
  const btnAnalyzeInIa = document.getElementById('btnAnalyzeInIa');
  const btnDownloadRecDirect = document.getElementById('btnDownloadRecDirect');

  function getTodayIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function getYesterdayIso() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  if (recDateInput) {
    recDateInput.value = getTodayIso();
  }

  btnRecToday?.addEventListener('click', () => {
    recDateInput.value = getTodayIso();
    loadRecordings();
  });

  btnRecYesterday?.addEventListener('click', () => {
    recDateInput.value = getYesterdayIso();
    loadRecordings();
  });

  btnOpenRecordings?.addEventListener('click', () => {
    modalRecordings.classList.add('active');
    if (!recDateInput.value) recDateInput.value = getTodayIso();
    loadRecordings();
  });

  btnCloseRecordings?.addEventListener('click', () => {
    modalRecordings.classList.remove('active');
    closeRecPlayer();
  });

  modalRecordings?.addEventListener('click', (e) => {
    if (e.target === modalRecordings) {
      modalRecordings.classList.remove('active');
      closeRecPlayer();
    }
  });

  btnFetchRecordings?.addEventListener('click', () => {
    loadRecordings();
  });

  recCamSelect?.addEventListener('change', () => {
    loadRecordings();
  });

  function closeRecPlayer() {
    if (recVideoTag) {
      recVideoTag.pause();
      recVideoTag.src = '';
    }
    if (recPlayerBox) recPlayerBox.style.display = 'none';
  }

  btnCloseRecPlayer?.addEventListener('click', closeRecPlayer);

  async function loadRecordings() {
    const camId = recCamSelect.value || 'cam2';
    const date = recDateInput.value || getTodayIso();

    recLoadingSpinner.style.display = 'inline';
    btnFetchRecordings.disabled = true;
    recCountLabel.textContent = `Consultando ${camId.toUpperCase()} para o dia ${date}...`;

    try {
      const res = await fetch(`/api/recordings/${camId}?date=${date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.recordings || data.recordings.length === 0) {
        recTableBody.innerHTML = `
          <tr>
            <td colspan="4" style="text-align: center; padding: 30px; color: #94a3b8;">
              Nenhuma gravação encontrada no cartão SD para esta data (${date}).
            </td>
          </tr>
        `;
        recCountLabel.textContent = `0 gravações encontradas para ${date}.`;
        return;
      }

      recCountLabel.textContent = `${data.total} gravações encontradas (${camId.toUpperCase()} • ${date}):`;

      recTableBody.innerHTML = data.recordings.map(rec => {
        const streamUrl = `/api/recordings/${camId}/stream?fileName=${encodeURIComponent(rec.fileName)}&startTime=${encodeURIComponent(rec.startTime)}&endTime=${encodeURIComponent(rec.endTime)}`;
        const downloadUrl = `${streamUrl}&download=1`;
        const iaUrl = `/ia?cam=${camId}&videoUrl=${encodeURIComponent(streamUrl)}`;
        const startShort = rec.startTime.slice(11);
        const endShort = rec.endTime.slice(11);

        const badgeHtml = rec.type === 'motion'
          ? `<span class="badge-rec-motion">🏃 Movimento</span>`
          : `<span class="badge-rec-regular">⏱️ Contínuo</span>`;

        return `
          <tr>
            <td>
              <div class="rec-time-cell">
                <span>🕒</span>
                <span><strong>${startShort}</strong> ➔ ${endShort}</span>
              </div>
            </td>
            <td>
              <span style="font-family: var(--font-mono); color: #cbd5e1;">${rec.durationSeconds}s</span>
            </td>
            <td>${badgeHtml}</td>
            <td style="text-align: right;">
              <div class="rec-row-actions">
                <button class="btn-play-clip" data-url="${streamUrl}" data-title="${startShort} (${rec.durationSeconds}s)" data-rec='${JSON.stringify(rec).replace(/'/g, "&apos;")}'>
                  ▶️ Assistir
                </button>
                <a href="${iaUrl}" target="_blank" class="btn-rec-ai" style="padding: 4px 8px; font-size: 0.76rem;" title="Analisar no Lab de IA">
                  🤖 IA
                </a>
                <a href="${downloadUrl}" class="btn-dl-clip" title="Baixar MP4 para seu computador">
                  ⬇️ Baixar
                </a>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Associa eventos de play nos botões da tabela
      recTableBody.querySelectorAll('.btn-play-clip').forEach(btn => {
        btn.addEventListener('click', () => {
          const url = btn.dataset.url;
          const title = btn.dataset.title;
          const rec = JSON.parse(btn.dataset.rec);

          recPlayerBox.style.display = 'block';
          recPlayerTitle.textContent = `▶️ Reproduzindo: ${rec.startTime} ➔ ${rec.endTime.slice(11)} (${rec.durationSeconds}s)`;
          recPlayerInfo.innerHTML = `Transmitindo da câmera (${camId.toUpperCase()}) • Cache volátil de 4 vídeos • Tamanho: ${rec.durationSeconds} segundos`;
          
          btnAnalyzeInIa.href = `/ia?cam=${camId}&videoUrl=${encodeURIComponent(url)}`;
          btnDownloadRecDirect.href = `${url}&download=1`;

          recVideoTag.src = url;
          recVideoTag.play().catch(() => {});
          recPlayerBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });

    } catch (err) {
      recTableBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 30px; color: #ef4444;">
            ❌ Erro ao consultar a câmera: ${err.message}. Verifique se a câmera está online.
          </td>
        </tr>
      `;
      recCountLabel.textContent = `Erro ao carregar gravações.`;
    } finally {
      recLoadingSpinner.style.display = 'none';
      btnFetchRecordings.disabled = false;
    }
  }
});
