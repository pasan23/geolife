(function () {
  const CONFIG = {
    width: 144,
    height: 90,
    landRatio: 0.76,
    initialStates: 110,
    resourceMin: 1,
    resourceMax: 5,
    bonusProb: 0.05,
    bonusMin: 8,
    bonusMax: 16,
    attackThreshold: 1.35,
    maxBreakthrough: 2,
    imperialScale: 0.18,
    dispersionPenalty: 0.06,
    capitalDistancePenalty: 0.11,
    tradeBonus: 0.12,
    externalTradeBonus: 0.08,
    economicVolatility: 0.1,
    battleVolatility: 0.58,
    remoteSecessionChance: 0.014,
    secessionMinSize: 16,
    recentOwnershipWindow: 500,
    peaceStagnationThreshold: 3,
    peaceDurationMin: 6,
    peaceDurationMax: 14,
    rainDuration: 100,
    rainStrength: 0.35,
    brushRadius: 2,
    tickRate: 10
  };

  const PARAM_DEFS = [
    { key: "attackThreshold", label: "Umbral ofensivo", min: 1.05, max: 2.4, step: 0.05, hint: "Ventaja mínima para considerar ofensivas.", format: (v) => v.toFixed(2) },
    { key: "maxBreakthrough", label: "Ruptura máxima", min: 1, max: 4, step: 1, hint: "Máximo de provincias disputadas por ofensiva.", format: (v) => String(v) },
    { key: "imperialScale", label: "Bonus imperial", min: 0, max: 0.5, step: 0.01, hint: "Ventaja estructural del tamaño compacto.", format: (v) => v.toFixed(2) },
    { key: "dispersionPenalty", label: "Coste de dispersión", min: 0, max: 0.18, step: 0.01, hint: "Penalización administrativa por extensión.", format: (v) => v.toFixed(2) },
    { key: "capitalDistancePenalty", label: "Coste por distancia a capital", min: 0, max: 0.3, step: 0.005, hint: "Castigo fiscal de la periferia lejana.", format: (v) => v.toFixed(3) },
    { key: "tradeBonus", label: "Comercio interno", min: 0, max: 0.35, step: 0.01, hint: "Sinergias económicas dentro del propio Estado.", format: (v) => v.toFixed(2) },
    { key: "externalTradeBonus", label: "Comercio exterior", min: 0, max: 0.18, step: 0.01, hint: "Flujo comercial entre vecinos pacíficos.", format: (v) => v.toFixed(2) },
    { key: "remoteSecessionChance", label: "Prob. secesión periférica", min: 0, max: 0.06, step: 0.0005, hint: "Riesgo base de escisión en periferias remotas.", format: (v) => v.toFixed(4) },
    { key: "secessionMinSize", label: "Secesión mínima", min: 8, max: 28, step: 1, hint: "Tamaño mínimo exigido a un bloque secesionista.", format: (v) => String(v) },
    { key: "rainStrength", label: "Potencia de lluvia", min: 0.05, max: 0.85, step: 0.05, hint: "Depresión económica de las lluvias.", format: (v) => v.toFixed(2) }
  ];

  const canvas = document.getElementById("worldCanvas");
  const ctx = canvas.getContext("2d");
  const boardPanel = document.querySelector(".board-panel");
  const METRIC_DEFS = {
    alive: { label: "Estados totales", format: (v) => String(v) },
    polarity: { label: "Polaridad", format: (v) => v.toFixed(1) },
    war: { label: "Guerras", format: (v) => String(v) }
  };
  const ui = {
    startBtn: document.getElementById("startBtn"),
    playPauseBtn: document.getElementById("playPauseBtn"),
    stepBtn: document.getElementById("stepBtn"),
    resetBtn: document.getElementById("resetBtn"),
    fullscreenBtn: document.getElementById("fullscreenBtn"),
    brushWaterBtn: document.getElementById("brushWaterBtn"),
    brushRichBtn: document.getElementById("brushRichBtn"),
    brushLandBtn: document.getElementById("brushLandBtn"),
    brushRainBtn: document.getElementById("brushRainBtn"),
    brushSizeRange: document.getElementById("brushSizeRange"),
    brushSizeValue: document.getElementById("brushSizeValue"),
    speedRange: document.getElementById("speedRange"),
    speedValue: document.getElementById("speedValue"),
    toggleParamsBtn: document.getElementById("toggleParamsBtn"),
    paramSelect: document.getElementById("paramSelect"),
    paramRange: document.getElementById("paramRange"),
    paramLabel: document.getElementById("paramLabel"),
    paramValue: document.getElementById("paramValue"),
    paramHint: document.getElementById("paramHint"),
    turnStat: document.getElementById("turnStat"),
    aliveStat: document.getElementById("aliveStat"),
    polarityStat: document.getElementById("polarityStat"),
    warStat: document.getElementById("warStat"),
    statChartButtons: Array.from(document.querySelectorAll(".stat-chart-btn")),
    metricChartPanel: document.getElementById("metricChartPanel"),
    metricChartTitle: document.getElementById("metricChartTitle"),
    chartStartTurnInput: document.getElementById("chartStartTurnInput"),
    chartStartTurnRange: document.getElementById("chartStartTurnRange"),
    metricChartSummary: document.getElementById("metricChartSummary"),
    metricChartCanvas: document.getElementById("metricChartCanvas"),
    closeMetricChartBtn: document.getElementById("closeMetricChartBtn"),
    leaderboard: document.getElementById("leaderboard"),
    eventLog: document.getElementById("eventLog"),
    hoverStateName: document.getElementById("hoverStateName"),
    hoverCellInfo: document.getElementById("hoverCellInfo")
  };

  const local = {
    phase: "editor",
    brush: "water",
    isPainting: false,
    paused: false,
    activeParamKey: "attackThreshold",
    paramsCollapsed: false,
    activeMetricChart: null,
    chartStartTurn: 0,
    metricHistory: { alive: [], polarity: [], war: [] },
    lastRecordedTurn: -1,
    hoveredIdx: -1,
    renderPending: true,
    workerReady: false,
    worker: null,
    editorGrid: [],
    snapshot: null
  };

  function keyOf(x, y) {
    return y * CONFIG.width + x;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function createEditorGrid() {
    local.editorGrid = [];
    for (let y = 0; y < CONFIG.height; y += 1) {
      for (let x = 0; x < CONFIG.width; x += 1) {
        local.editorGrid.push({
          resource: 3,
          isWater: false,
          effectiveResource: 3,
          rainTurns: 0,
          rainPenalty: 0,
          ownerId: 0,
          ownerRecentShare: 0,
          capitalDistance: 0,
          capitalTaxFactor: 1,
          isCapital: false,
          flash: 0
        });
      }
    }
  }

  function resetMetricHistory() {
    local.metricHistory = { alive: [], polarity: [], war: [] };
    local.lastRecordedTurn = -1;
    local.activeMetricChart = null;
    local.chartStartTurn = 0;
  }

  function syncChartStartControls(series = []) {
    const minTurn = series.length > 0 ? series[0].turn : 0;
    const maxTurn = series.length > 0 ? series[series.length - 1].turn : 0;
    local.chartStartTurn = clamp(local.chartStartTurn, minTurn, maxTurn);
    ui.chartStartTurnInput.min = String(minTurn);
    ui.chartStartTurnInput.max = String(maxTurn);
    ui.chartStartTurnInput.value = String(local.chartStartTurn);
    ui.chartStartTurnRange.min = String(minTurn);
    ui.chartStartTurnRange.max = String(maxTurn);
    ui.chartStartTurnRange.value = String(local.chartStartTurn);
    ui.chartStartTurnInput.disabled = series.length < 2;
    ui.chartStartTurnRange.disabled = series.length < 2;
  }

  function makeWorker() {
    if (local.worker) local.worker.terminate();
    local.worker = new Worker("./sim-worker.js");
    local.workerReady = false;
    local.worker.addEventListener("message", handleWorkerMessage);
    local.worker.postMessage({ type: "init", config: { ...CONFIG } });
  }

  function handleWorkerMessage(event) {
    const message = event.data;
    if (message.type === "ready") {
      local.workerReady = true;
      return;
    }
    if (message.type === "snapshot") {
      local.snapshot = message.snapshot;
      local.phase = message.snapshot.phase;
      local.paused = Boolean(message.snapshot.paused);
      recordMetricHistory(message.snapshot);
      local.renderPending = true;
      syncToolbar();
      return;
    }
  }

  function recordMetricHistory(snapshot) {
    if (!snapshot || snapshot.phase !== "simulation") return;
    if (snapshot.turn === local.lastRecordedTurn) return;
    local.lastRecordedTurn = snapshot.turn;
    local.metricHistory.alive.push({ turn: snapshot.turn, value: snapshot.aliveCount });
    local.metricHistory.polarity.push({ turn: snapshot.turn, value: snapshot.polarity });
    local.metricHistory.war.push({ turn: snapshot.turn, value: snapshot.campaignCount });
    for (const key of Object.keys(local.metricHistory)) {
      if (local.metricHistory[key].length > 1500) {
        local.metricHistory[key] = local.metricHistory[key].slice(-1500);
      }
    }
  }

  function getParamDef(key) {
    return PARAM_DEFS.find((def) => def.key === key) || PARAM_DEFS[0];
  }

  function refreshParamEditor() {
    const def = getParamDef(local.activeParamKey);
    ui.paramLabel.textContent = def.label;
    ui.paramValue.textContent = def.format(CONFIG[def.key]);
    ui.paramHint.textContent = def.hint;
    ui.paramRange.min = String(def.min);
    ui.paramRange.max = String(def.max);
    ui.paramRange.step = String(def.step);
    ui.paramRange.value = String(CONFIG[def.key]);
    ui.paramSelect.value = def.key;
    ui.speedRange.value = String(CONFIG.tickRate);
    ui.speedValue.textContent = `${CONFIG.tickRate} t/s`;
    ui.brushSizeRange.value = String(CONFIG.brushRadius);
    ui.brushSizeValue.textContent = String(CONFIG.brushRadius);
  }

  function syncToolbar() {
    const inSimulation = local.phase === "simulation";
    const inEditor = local.phase === "editor";
    const isFullscreen = document.fullscreenElement === boardPanel;
    ui.playPauseBtn.disabled = !inSimulation;
    ui.stepBtn.disabled = !inSimulation;
    ui.startBtn.disabled = inSimulation || !local.workerReady;
    ui.brushWaterBtn.disabled = inSimulation;
    ui.brushRichBtn.disabled = inSimulation;
    ui.brushLandBtn.disabled = inSimulation;
    ui.brushRainBtn.disabled = inEditor;
    ui.playPauseBtn.textContent = local.paused ? "Reanudar" : "Pausar";
    ui.fullscreenBtn.textContent = isFullscreen ? "Salir de pantalla completa" : "Pantalla completa";
    ui.brushWaterBtn.classList.toggle("active-brush", local.brush === "water");
    ui.brushRichBtn.classList.toggle("active-brush", local.brush === "rich");
    ui.brushLandBtn.classList.toggle("active-brush", local.brush === "land");
    ui.brushRainBtn.classList.toggle("active-brush", local.brush === "rain");
    boardPanel.querySelector(".floating-params").classList.toggle("collapsed", local.paramsCollapsed);
    ui.toggleParamsBtn.textContent = local.paramsCollapsed ? "Mostrar parámetros" : "Minimizar";
    ui.toggleParamsBtn.setAttribute("aria-expanded", String(!local.paramsCollapsed));
    ui.metricChartPanel.hidden = !local.activeMetricChart;
    document.body.style.overflow = local.activeMetricChart ? "hidden" : "";
    ui.statChartButtons.forEach((button) => {
      button.classList.toggle("active-brush", button.dataset.metric === local.activeMetricChart);
    });
  }

  function pointerToGrid(event) {
    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const x = Math.floor((localX / rect.width) * CONFIG.width);
    const y = Math.floor((localY / rect.height) * CONFIG.height);
    if (x < 0 || x >= CONFIG.width || y < 0 || y >= CONFIG.height) return null;
    return { x, y, idx: keyOf(x, y) };
  }

  function forEachBrushCell(centerX, centerY, callback) {
    const radius = Math.max(1, CONFIG.brushRadius);
    for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
      for (let dx = -radius + 1; dx <= radius - 1; dx += 1) {
        if (dx * dx + dy * dy > (radius - 0.25) * (radius - 0.25)) continue;
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < 0 || x >= CONFIG.width || y < 0 || y >= CONFIG.height) continue;
        callback(local.editorGrid[keyOf(x, y)]);
      }
    }
  }

  function applyEditorBrush(x, y) {
    forEachBrushCell(x, y, (cell) => {
      if (local.brush === "water") {
        cell.isWater = true;
        cell.resource = 0;
        cell.effectiveResource = 0;
      } else if (local.brush === "rich") {
        cell.isWater = false;
        cell.resource = CONFIG.bonusMax;
        cell.effectiveResource = cell.resource;
      } else {
        cell.isWater = false;
        cell.resource = 3;
        cell.effectiveResource = 3;
      }
    });
    local.renderPending = true;
  }

  function postSnapshotRequest(type, extra = {}) {
    if (!local.worker) return;
    local.worker.postMessage({ type, ...extra });
  }

  function startSimulation() {
    resetMetricHistory();
    const gridSeed = local.editorGrid.map((cell) => ({
      resource: cell.resource,
      isWater: cell.isWater
    }));
    local.phase = "simulation";
    local.paused = false;
    local.brush = "rain";
    postSnapshotRequest("start", { gridSeed });
    syncToolbar();
  }

  function renderMetricChart() {
    if (!local.activeMetricChart) {
      ui.metricChartCanvas.innerHTML = "";
      ui.metricChartSummary.textContent = "Sin datos todavía.";
      return;
    }
    const metricKey = local.activeMetricChart;
    const def = METRIC_DEFS[metricKey];
    const fullSeries = local.metricHistory[metricKey];
    ui.metricChartTitle.textContent = `${def.label} por turno`;
    syncChartStartControls(fullSeries);
    const series = fullSeries.filter((point) => point.turn >= local.chartStartTurn);
    if (!series || series.length < 2) {
      ui.metricChartCanvas.innerHTML = "";
      ui.metricChartSummary.textContent = "Aún no hay suficientes turnos para trazar la evolución.";
      return;
    }

    const width = 520;
    const height = 190;
    const leftPad = 46;
    const rightPad = 16;
    const topPad = 16;
    const bottomPad = 24;
    const minTurn = series[0].turn;
    const maxTurn = series[series.length - 1].turn;
    const values = series.map((point) => point.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const logValues = values.map((value) => Math.log10(1 + Math.max(0, value)));
    const minLog = 0;
    const maxLog = Math.max(...logValues);
    const spread = Math.max(1e-6, maxLog - minLog);
    const turnSpread = Math.max(1, maxTurn - minTurn);

    function xForTurn(turn) {
      return leftPad + ((turn - minTurn) / turnSpread) * (width - leftPad - rightPad);
    }

    function yForValue(value) {
      const logged = Math.log10(1 + Math.max(0, value));
      return height - bottomPad - ((logged - minLog) / spread) * (height - topPad - bottomPad);
    }

    const points = series.map((point) => {
      const x = xForTurn(point.turn);
      const y = yForValue(point.value);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const latest = series[series.length - 1].value;
    const earliest = series[0].value;
    const delta = latest - earliest;
    const deltaText = `${delta >= 0 ? "+" : ""}${def.format(delta)}`;
    const tickCandidates = [0, 1, 2, 5];
    let scale = 10;
    while (scale <= maxValue * 1.4 + 1) {
      tickCandidates.push(scale);
      scale *= 10;
    }
    const ticks = tickCandidates
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .filter((value) => value >= 0 && value <= maxValue)
      .sort((a, b) => a - b);
    if (!ticks.includes(0)) ticks.unshift(0);
    if (!ticks.includes(maxValue)) ticks.push(maxValue);
    const yTicks = ticks.slice(0, 8).map((value) => {
      const y = yForValue(value);
      return {
        value,
        y,
        label: Number.isInteger(value) ? String(value) : def.format(value)
      };
    });
    const gridLines = yTicks.map((tick) => `
      <line x1="${leftPad}" y1="${tick.y.toFixed(1)}" x2="${(width - rightPad).toFixed(1)}" y2="${tick.y.toFixed(1)}" stroke="rgba(123, 92, 52, 0.12)" stroke-width="1"></line>
      <text x="${(leftPad - 8).toFixed(1)}" y="${(tick.y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#786757">${tick.label}</text>
    `).join("");
    const lastPoint = series[series.length - 1];
    const lastX = xForTurn(lastPoint.turn);
    const lastY = yForValue(lastPoint.value);
    ui.metricChartSummary.textContent = `Turnos ${minTurn}-${maxTurn} · min ${def.format(minValue)} · max ${def.format(maxValue)} · cambio ${deltaText} · eje Y log`;
    ui.metricChartCanvas.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${def.label} por turno">
        <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.42)"></rect>
        ${gridLines}
        <line x1="${leftPad}" y1="${height - bottomPad}" x2="${width - rightPad}" y2="${height - bottomPad}" stroke="rgba(123, 92, 52, 0.24)" stroke-width="1"></line>
        <line x1="${leftPad}" y1="${topPad}" x2="${leftPad}" y2="${height - bottomPad}" stroke="rgba(123, 92, 52, 0.24)" stroke-width="1"></line>
        <polyline fill="none" stroke="#c96f37" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${points}"></polyline>
        <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" fill="#c96f37"></circle>
        <text x="${(width - rightPad).toFixed(1)}" y="${(height - 6).toFixed(1)}" text-anchor="end" font-size="11" fill="#786757">turno</text>
      </svg>
    `;
  }

  function drawEditor() {
    const cw = canvas.width / CONFIG.width;
    const ch = canvas.height / CONFIG.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let idx = 0; idx < local.editorGrid.length; idx += 1) {
      const cell = local.editorGrid[idx];
      const x = (idx % CONFIG.width) * cw;
      const y = Math.floor(idx / CONFIG.width) * ch;
      ctx.fillStyle = cell.isWater ? "rgb(3, 5, 8)" : (cell.resource >= CONFIG.bonusMin ? "hsl(46 82% 56%)" : "hsl(145 24% 32%)");
      ctx.fillRect(x, y, cw + 0.8, ch + 0.8);
    }
  }

  function blend(color, boost) {
    const match = /hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/.exec(color);
    if (!match) return color;
    return `hsl(${match[1]} ${match[2]}% ${Math.min(80, Number(match[3]) + boost)}%)`;
  }

  function drawSimulation(snapshot) {
    const cw = canvas.width / CONFIG.width;
    const ch = canvas.height / CONFIG.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let idx = 0; idx < snapshot.cells.length; idx += 1) {
      const cell = snapshot.cells[idx];
      const x = (idx % CONFIG.width) * cw;
      const y = Math.floor(idx / CONFIG.width) * ch;
      if (cell.isWater) {
        ctx.fillStyle = "rgb(3, 5, 8)";
        ctx.fillRect(x, y, cw + 0.8, ch + 0.8);
        continue;
      }
      const owner = snapshot.stateMeta[cell.ownerId];
      ctx.fillStyle = blend(owner ? owner.color : "hsl(220 18% 22%)", Math.min(16, cell.resource * 0.9));
      ctx.fillRect(x, y, cw + 0.8, ch + 0.8);
      if (cell.rainTurns > 0) {
        ctx.fillStyle = `rgba(83, 150, 255, ${0.12 + cell.rainPenalty * 0.32})`;
        ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
      }
      if (cell.flash > 0) {
        ctx.fillStyle = `rgba(255, 241, 188, ${(cell.flash / 7) * 0.45})`;
        ctx.fillRect(x, y, cw + 0.4, ch + 0.4);
      }
    }

    ctx.strokeStyle = "rgba(6, 10, 18, 0.4)";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let idx = 0; idx < snapshot.cells.length; idx += 1) {
      const cell = snapshot.cells[idx];
      if (cell.isWater) continue;
      const x = (idx % CONFIG.width) * cw;
      const y = Math.floor(idx / CONFIG.width) * ch;
      const east = (idx % CONFIG.width) < CONFIG.width - 1 ? snapshot.cells[idx + 1] : null;
      const south = idx + CONFIG.width < snapshot.cells.length ? snapshot.cells[idx + CONFIG.width] : null;
      if (east && !east.isWater && east.ownerId !== cell.ownerId) {
        ctx.moveTo(x + cw, y);
        ctx.lineTo(x + cw, y + ch);
      }
      if (south && !south.isWater && south.ownerId !== cell.ownerId) {
        ctx.moveTo(x, y + ch);
        ctx.lineTo(x + cw, y + ch);
      }
    }
    ctx.stroke();

    for (const stateEntry of snapshot.topStates) {
      const capital = snapshot.cells[stateEntry.capitalIdx];
      if (!capital) continue;
      const cx = capital.x * cw + cw / 2;
      const cy = capital.y * ch + ch / 2;
      ctx.beginPath();
      ctx.fillStyle = "rgba(248, 252, 255, 0.95)";
      ctx.arc(cx, cy, Math.max(2, Math.min(cw, ch) * 0.32), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function render() {
    if (local.phase === "editor") drawEditor();
    else if (local.snapshot) drawSimulation(local.snapshot);
    updateHud();
  }

  function updateHud() {
    if (local.phase === "editor") {
      const landCount = local.editorGrid.filter((cell) => !cell.isWater).length;
      ui.turnStat.textContent = "0";
      ui.aliveStat.textContent = String(landCount);
      ui.polarityStat.textContent = "0.0";
      ui.warStat.textContent = "0";
      ui.leaderboard.innerHTML = "";
      const rows = [
        ['hsl(145 24% 32%)', 'Tierra normal', 'recurso base'],
        ['hsl(46 82% 56%)', 'Tierra rica', 'recurso alto'],
        ['rgb(3, 5, 8)', 'Mar', 'inutilizable']
      ];
      rows.forEach(([color, name, score]) => {
        const li = document.createElement("li");
        li.innerHTML = `<div class="name"><span class="swatch" style="background:${color}"></span><span>${name}</span></div><span class="score">${score}</span>`;
        ui.leaderboard.appendChild(li);
      });
      ui.eventLog.innerHTML = "<li>Fase de edición.</li>";
      updateHoverEditor();
      renderMetricChart();
      return;
    }

    const snapshot = local.snapshot;
    if (!snapshot) return;
    ui.turnStat.textContent = String(snapshot.turn);
    ui.aliveStat.textContent = String(snapshot.aliveCount);
    ui.polarityStat.textContent = snapshot.polarity.toFixed(1);
    ui.warStat.textContent = String(snapshot.campaignCount);

    ui.leaderboard.innerHTML = "";
    snapshot.topStates.forEach((entry) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="name"><span class="swatch" style="background:${entry.color}"></span><span>${entry.name}</span></div><span class="score">${entry.cells} · ${Math.round(entry.power)}</span>`;
      ui.leaderboard.appendChild(li);
    });

    ui.eventLog.innerHTML = "";
    snapshot.events.forEach((event) => {
      const li = document.createElement("li");
      li.textContent = `Turno ${event.turn}: ${event.text}`;
      ui.eventLog.appendChild(li);
    });
    updateHoverSimulation();
    renderMetricChart();
  }

  function updateHoverEditor() {
    if (local.hoveredIdx < 0) {
      ui.hoverStateName.textContent = "Ninguno";
      ui.hoverCellInfo.textContent = "-";
      return;
    }
    const cell = local.editorGrid[local.hoveredIdx];
    const x = local.hoveredIdx % CONFIG.width;
    const y = Math.floor(local.hoveredIdx / CONFIG.width);
    if (cell.isWater) {
      ui.hoverStateName.textContent = "Mar";
      ui.hoverCellInfo.textContent = `celda marítima · (${x}, ${y})`;
      return;
    }
    ui.hoverStateName.textContent = cell.resource >= CONFIG.bonusMin ? "Tierra rica" : "Tierra";
    ui.hoverCellInfo.textContent = `r=${cell.resource} · (${x}, ${y})`;
  }

  function updateHoverSimulation() {
    if (local.hoveredIdx < 0 || !local.snapshot) {
      ui.hoverStateName.textContent = "Ninguno";
      ui.hoverCellInfo.textContent = "-";
      return;
    }
    const cell = local.snapshot.cells[local.hoveredIdx];
    const x = local.hoveredIdx % CONFIG.width;
    const y = Math.floor(local.hoveredIdx / CONFIG.width);
    if (!cell || cell.isWater) {
      ui.hoverStateName.textContent = "Mar";
      ui.hoverCellInfo.textContent = `celda marítima · (${x}, ${y})`;
      return;
    }
    const owner = local.snapshot.stateMeta[cell.ownerId];
    const rainText = cell.rainTurns > 0 ? ` · lluvia=${cell.rainTurns}` : "";
    ui.hoverStateName.textContent = owner ? owner.name : "Vacío";
    ui.hoverCellInfo.textContent = `r=${cell.resource} · eco=${cell.effectiveResource.toFixed(1)} · dist=${cell.capitalDistance} · cap=${cell.capitalTaxFactor.toFixed(2)} · lealtad=${cell.ownerRecentShare.toFixed(2)}${rainText} · (${x}, ${y})${cell.isCapital ? " · capital" : ""}`;
  }

  function bindControls() {
    ui.startBtn.addEventListener("click", startSimulation);
    ui.playPauseBtn.addEventListener("click", () => {
      if (local.phase !== "simulation") return;
      local.paused = !local.paused;
      postSnapshotRequest(local.paused ? "pause" : "resume");
      syncToolbar();
    });
    ui.stepBtn.addEventListener("click", () => {
      if (local.phase !== "simulation") return;
      local.paused = true;
      postSnapshotRequest("pause");
      postSnapshotRequest("step");
      syncToolbar();
    });
    ui.resetBtn.addEventListener("click", () => {
      local.phase = "editor";
      local.paused = true;
      local.snapshot = null;
      local.hoveredIdx = -1;
      resetMetricHistory();
      createEditorGrid();
      postSnapshotRequest("reset");
      local.renderPending = true;
      syncToolbar();
    });
    ui.fullscreenBtn.addEventListener("click", async () => {
      if (document.fullscreenElement === boardPanel) await document.exitFullscreen();
      else await boardPanel.requestFullscreen();
      syncToolbar();
    });
    document.addEventListener("fullscreenchange", syncToolbar);

    ui.brushWaterBtn.addEventListener("click", () => { local.brush = "water"; syncToolbar(); });
    ui.brushRichBtn.addEventListener("click", () => { local.brush = "rich"; syncToolbar(); });
    ui.brushLandBtn.addEventListener("click", () => { local.brush = "land"; syncToolbar(); });
    ui.brushRainBtn.addEventListener("click", () => { local.brush = "rain"; syncToolbar(); });
    ui.toggleParamsBtn.addEventListener("click", () => {
      local.paramsCollapsed = !local.paramsCollapsed;
      syncToolbar();
    });
    ui.statChartButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const series = local.metricHistory[button.dataset.metric] || [];
        local.chartStartTurn = series.length > 0 ? series[0].turn : 0;
        local.activeMetricChart = local.activeMetricChart === button.dataset.metric ? null : button.dataset.metric;
        local.renderPending = true;
        syncToolbar();
      });
    });
    ui.closeMetricChartBtn.addEventListener("click", () => {
      local.activeMetricChart = null;
      local.renderPending = true;
      syncToolbar();
    });
    function updateChartStartTurn(rawValue) {
      if (!local.activeMetricChart) return;
      const fullSeries = local.metricHistory[local.activeMetricChart] || [];
      const minTurn = fullSeries.length > 0 ? fullSeries[0].turn : 0;
      const maxTurn = fullSeries.length > 0 ? fullSeries[fullSeries.length - 1].turn : 0;
      local.chartStartTurn = Math.round(clamp(Number(rawValue) || 0, minTurn, maxTurn));
      ui.chartStartTurnInput.value = String(local.chartStartTurn);
      ui.chartStartTurnRange.value = String(local.chartStartTurn);
      local.renderPending = true;
    }
    ui.chartStartTurnInput.addEventListener("input", (event) => {
      updateChartStartTurn(event.target.value);
    });
    ui.chartStartTurnRange.addEventListener("input", (event) => {
      updateChartStartTurn(event.target.value);
    });
    ui.metricChartPanel.addEventListener("click", (event) => {
      if (event.target !== ui.metricChartPanel) return;
      local.activeMetricChart = null;
      local.renderPending = true;
      syncToolbar();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !local.activeMetricChart) return;
      local.activeMetricChart = null;
      local.renderPending = true;
      syncToolbar();
    });
    ui.brushSizeRange.addEventListener("input", (event) => {
      CONFIG.brushRadius = Number(event.target.value);
      ui.brushSizeValue.textContent = String(CONFIG.brushRadius);
      postSnapshotRequest("config", { config: { brushRadius: CONFIG.brushRadius } });
    });

    ui.paramSelect.innerHTML = "";
    PARAM_DEFS.forEach((def) => {
      const option = document.createElement("option");
      option.value = def.key;
      option.textContent = def.label;
      ui.paramSelect.appendChild(option);
    });
    ui.paramSelect.addEventListener("change", (event) => {
      local.activeParamKey = event.target.value;
      refreshParamEditor();
    });
    ui.paramRange.addEventListener("input", (event) => {
      const def = getParamDef(local.activeParamKey);
      const rawValue = Number(event.target.value);
      CONFIG[def.key] = def.step >= 1 ? Math.round(rawValue) : rawValue;
      refreshParamEditor();
      postSnapshotRequest("config", { config: { [def.key]: CONFIG[def.key] } });
    });
    ui.speedRange.addEventListener("input", (event) => {
      CONFIG.tickRate = Number(event.target.value);
      ui.speedValue.textContent = `${CONFIG.tickRate} t/s`;
      postSnapshotRequest("config", { config: { tickRate: CONFIG.tickRate } });
    });

    canvas.addEventListener("mousemove", (event) => {
      const point = pointerToGrid(event);
      local.hoveredIdx = point ? point.idx : -1;
      if (local.isPainting && point) {
        if (local.phase === "editor" && local.brush !== "rain") {
          applyEditorBrush(point.x, point.y);
        } else if (local.phase === "simulation" && local.brush === "rain") {
          postSnapshotRequest("rain", { x: point.x, y: point.y });
        }
      }
      local.renderPending = true;
    });

    canvas.addEventListener("mousedown", (event) => {
      const point = pointerToGrid(event);
      if (!point) return;
      local.isPainting = true;
      if (local.phase === "editor" && local.brush !== "rain") {
        applyEditorBrush(point.x, point.y);
      } else if (local.phase === "simulation" && local.brush === "rain") {
        postSnapshotRequest("rain", { x: point.x, y: point.y });
      }
      local.renderPending = true;
    });
    window.addEventListener("mouseup", () => { local.isPainting = false; });
    canvas.addEventListener("mouseleave", () => {
      local.isPainting = false;
      local.hoveredIdx = -1;
      local.renderPending = true;
    });
    canvas.addEventListener("contextmenu", (event) => {
      if (local.phase !== "editor") return;
      event.preventDefault();
      local.brush = "land";
      const point = pointerToGrid(event);
      if (point) applyEditorBrush(point.x, point.y);
      syncToolbar();
    });
  }

  function animate() {
    if (local.renderPending) {
      render();
      local.renderPending = false;
    }
    requestAnimationFrame(animate);
  }

  createEditorGrid();
  makeWorker();
  bindControls();
  refreshParamEditor();
  syncToolbar();
  render();
  animate();
})();
