let CONFIG = {};

const aNames = ["Aurora", "Bruma", "Cenit", "Delta", "Estela", "Faro", "Greda", "Heraldo", "Istmo", "Jade", "Límite", "Nácar", "Órbita", "Páramo", "Riada", "Solar"];
const bNames = ["Liga", "Corona", "República", "Pacto", "Dominio", "Directorio", "Mandato", "Consorcio", "Federación", "Esfera"];

const state = {
  grid: [],
  states: new Map(),
  fronts: new Map(),
  nextStateId: 1,
  turn: 0,
  events: [],
  totalDeaths: 0,
  totalBirths: 0,
  phase: "editor",
  paused: true,
  intervalId: null,
  lastCampaignCount: 0
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seededUnit(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function seededRange(seed, min, max) {
  return min + seededUnit(seed) * (max - min);
}

function keyOf(x, y) {
  return y * CONFIG.width + x;
}

function warKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function getCellByIdx(idx) {
  return state.grid[idx];
}

function getCell(x, y) {
  return state.grid[keyOf(x, y)];
}

function neighbors4(x, y) {
  const out = [];
  if (x > 0) out.push([x - 1, y]);
  if (x < CONFIG.width - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < CONFIG.height - 1) out.push([x, y + 1]);
  return out;
}

function readableName(id) {
  return `${bNames[id % bNames.length]} de ${aNames[id % aNames.length]}`;
}

function colorForState(id) {
  const hue = (id * 43) % 360;
  const sat = 58 + (id * 11) % 20;
  const light = 42 + (id * 17) % 16;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function createCell(x, y, seed = null) {
  const resource = seed ? seed.resource : 3;
  const isWater = seed ? seed.isWater : false;
  return {
    x,
    y,
    ownerId: 0,
    resource,
    isWater,
    isCapital: false,
    flash: 0,
    effectiveResource: resource,
    capitalDistance: 0,
    capitalTaxFactor: 1,
    ownerRecentShare: 0,
    lastOwnerId: 0,
    rainTurns: 0,
    rainPenalty: 0
  };
}

function createStateRecord(id, capitalIdx) {
  return {
    id,
    name: readableName(id),
    color: colorForState(id),
    capitalIdx,
    cells: new Set(),
    neighbors: new Set(),
    totalPower: 0,
    basePower: 0,
    economicModifier: 1,
    externalTradePower: 0,
    perimeter: 0,
    avgDistance: 0,
    maxDistance: 0,
    tradePartners: new Map(),
    alive: true
  };
}

function manhattan(idxA, idxB) {
  const a = getCellByIdx(idxA);
  const b = getCellByIdx(idxB);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function connectedComponents(cells) {
  const remaining = new Set(cells);
  const components = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value;
    const queue = [start];
    const visited = new Set([start]);
    while (queue.length > 0) {
      const idx = queue.shift();
      const cell = getCellByIdx(idx);
      for (const [nx, ny] of neighbors4(cell.x, cell.y)) {
        const next = keyOf(nx, ny);
        if (remaining.has(next) && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    for (const idx of visited) remaining.delete(idx);
    components.push(visited);
  }
  return components;
}

function chooseCapital(component) {
  const anchor = component.values().next().value;
  let best = null;
  let bestScore = -Infinity;
  for (const idx of component) {
    const cell = getCellByIdx(idx);
    const score = cell.resource - manhattan(idx, anchor) * 0.02;
    if (score > bestScore) {
      bestScore = score;
      best = idx;
    }
  }
  return best;
}

function setCellOwner(cell, ownerId) {
  if (cell.ownerId === ownerId) return;
  cell.ownerId = ownerId;
  cell.lastOwnerId = ownerId;
  cell.ownerRecentShare = ownerId ? 1 / CONFIG.recentOwnershipWindow : 0;
}

function updateOwnershipMemory() {
  const alpha = 1 / CONFIG.recentOwnershipWindow;
  for (const cell of state.grid) {
    if (cell.isWater || !cell.ownerId) {
      cell.lastOwnerId = 0;
      cell.ownerRecentShare = 0;
      continue;
    }
    if (cell.lastOwnerId === cell.ownerId) {
      cell.ownerRecentShare = clamp(cell.ownerRecentShare + alpha * (1 - cell.ownerRecentShare), alpha, 1);
    } else {
      cell.lastOwnerId = cell.ownerId;
      cell.ownerRecentShare = alpha;
    }
  }
}

function calculateCapitalTaxFactor(distance, territorySize) {
  const distanceScale = Math.max(2, Math.sqrt(territorySize) * 0.92);
  const distancePressure = Math.pow(distance / distanceScale, 1.32);
  return clamp(1 - CONFIG.capitalDistancePenalty * distancePressure, 0.04, 1);
}

function calculatePeaceTradeFlow(entry, neighbor, border) {
  const capitalDistance = manhattan(entry.capitalIdx, neighbor.capitalIdx);
  const gravityMass = Math.sqrt(Math.max(1, entry.basePower) * Math.max(1, neighbor.basePower));
  const distanceDecay = Math.max(4, Math.pow(capitalDistance + 1, 0.72));
  return CONFIG.externalTradeBonus * gravityMass * (1 + border * 0.8) / distanceDecay;
}

function getAliveStates() {
  return Array.from(state.states.values()).filter((entry) => entry.alive && entry.cells.size > 0);
}

function updateStates() {
  for (const entry of state.states.values()) {
    entry.cells.clear();
    entry.neighbors.clear();
    entry.totalPower = 0;
    entry.basePower = 0;
    entry.economicModifier = 1;
    entry.externalTradePower = 0;
    entry.perimeter = 0;
    entry.avgDistance = 0;
    entry.maxDistance = 0;
    entry.tradePartners = new Map();
    entry.alive = false;
  }

  const borderData = new Map();
  for (const cell of state.grid) {
    if (cell.isWater || !cell.ownerId) continue;
    const owner = state.states.get(cell.ownerId);
    if (!owner) continue;
    owner.alive = true;
    owner.cells.add(keyOf(cell.x, cell.y));
    if (cell.isCapital) owner.capitalIdx = keyOf(cell.x, cell.y);
  }

  const aliveStates = getAliveStates();
  for (const entry of aliveStates) {
    if (!entry.cells.has(entry.capitalIdx)) {
      entry.capitalIdx = chooseCapital(entry.cells);
      getCellByIdx(entry.capitalIdx).isCapital = true;
    }

    const sizeFactor = Math.log1p(entry.cells.size);
    const economicModifier = 1 + seededRange(entry.id * 997 + state.turn * 131, -CONFIG.economicVolatility, CONFIG.economicVolatility);
    let gross = 0;
    let distanceAcc = 0;
    let maxDistance = 0;

    for (const idx of entry.cells) {
      const cell = getCellByIdx(idx);
      const distance = manhattan(idx, entry.capitalIdx);
      let friendly = 0;
      let perimeter = 0;
      for (const [nx, ny] of neighbors4(cell.x, cell.y)) {
        const neighbor = getCell(nx, ny);
        if (neighbor.isWater) {
          perimeter += 1;
          continue;
        }
        if (neighbor.ownerId === entry.id) {
          friendly += 1;
        } else if (neighbor.ownerId) {
          perimeter += 1;
          entry.neighbors.add(neighbor.ownerId);
          const pair = warKey(entry.id, neighbor.ownerId);
          if (!borderData.has(pair)) {
            borderData.set(pair, new Map());
          }
          if (!borderData.get(pair).has(entry.id)) {
            borderData.get(pair).set(entry.id, { border: new Set(), targets: new Set() });
          }
          const ownerData = borderData.get(pair).get(entry.id);
          ownerData.border.add(idx);
          ownerData.targets.add(keyOf(nx, ny));
        } else {
          perimeter += 1;
        }
      }

      const capitalTaxFactor = calculateCapitalTaxFactor(distance, entry.cells.size);
      const weatherFactor = 1 - cell.rainPenalty;
      const localTrade = cell.resource * CONFIG.tradeBonus * (friendly / 4);
      const localGross = (cell.resource + localTrade) * economicModifier * capitalTaxFactor * weatherFactor;
      cell.capitalDistance = distance;
      cell.capitalTaxFactor = capitalTaxFactor;
      cell.effectiveResource = localGross;
      entry.basePower += cell.resource;
      entry.perimeter += perimeter;
      distanceAcc += distance;
      maxDistance = Math.max(maxDistance, distance);
      gross += localGross;
    }

    const avgDistance = distanceAcc / Math.max(1, entry.cells.size);
    const compactness = clamp(1 - entry.perimeter / Math.max(entry.cells.size * 2.8, 6), 0.08, 1);
    const adminPenalty = CONFIG.dispersionPenalty * avgDistance / Math.max(2, Math.sqrt(entry.cells.size));
    const multiplier = clamp(1 + CONFIG.imperialScale * sizeFactor * (0.45 + compactness) - adminPenalty, 0.72, 2.6);
    entry.economicModifier = economicModifier;
    entry.avgDistance = avgDistance;
    entry.maxDistance = maxDistance;
    entry.totalPower = gross * multiplier;
  }

  const processed = new Set();
  for (const entry of aliveStates) {
    for (const neighborId of entry.neighbors) {
      const pair = warKey(entry.id, neighborId);
      if (processed.has(pair)) continue;
      processed.add(pair);
      const neighbor = state.states.get(neighborId);
      if (!neighbor || !neighbor.alive) continue;
      const pairData = borderData.get(pair);
      const border = pairData ? Math.min(
        pairData.get(entry.id)?.border.size || 0,
        pairData.get(neighborId)?.border.size || 0
      ) : 0;
      if (border === 0) continue;
      const pairFlow = calculatePeaceTradeFlow(entry, neighbor, border);
      entry.tradePartners.set(neighborId, pairFlow);
      neighbor.tradePartners.set(entry.id, pairFlow);
      entry.externalTradePower += pairFlow;
      neighbor.externalTradePower += pairFlow;
    }
  }

  state.fronts = new Map();
  for (const entry of aliveStates) {
    entry.totalPower += entry.externalTradePower;
    let best = null;
    for (const neighborId of entry.neighbors) {
      const neighbor = state.states.get(neighborId);
      if (!neighbor || !neighbor.alive) continue;
      const pair = borderData.get(warKey(entry.id, neighborId));
      const targetCells = pair ? Array.from(pair.get(entry.id)?.targets || []) : [];
      const border = pair ? (pair.get(entry.id)?.border.size || 0) : 0;
      if (border === 0 || targetCells.length === 0) continue;
      const valuedTargets = targetCells.map((targetIdx) => ({ targetIdx, value: estimateProvinceValue(entry, targetIdx) })).sort((a, b) => b.value - a.value);
      const projectedGain = valuedTargets.slice(0, Math.min(CONFIG.maxBreakthrough, valuedTargets.length)).reduce((sum, t) => sum + t.value, 0);
      const peaceTradeLoss = entry.tradePartners.get(neighbor.id) || 0;
      const netBenefit = projectedGain - peaceTradeLoss * 1.85;
      const opportunityCost = peaceTradeLoss / Math.max(2, projectedGain);
      const ratio = entry.totalPower / Math.max(1, neighbor.totalPower);
      const ratioFactor = clamp((ratio - CONFIG.attackThreshold) / Math.max(0.08, CONFIG.attackThreshold * 0.9), 0, 1.4);
      const benefitFactor = clamp(0.12 + (netBenefit + projectedGain * 0.65) / Math.max(3, projectedGain + peaceTradeLoss * 2.1 + 3), 0.03, 1.15);
      const peaceBias = clamp(1.08 - opportunityCost * 0.92, 0.08, 1.08);
      const warChance = clamp((0.01 + ratioFactor * 0.34 + benefitFactor * 0.22) * peaceBias, 0.003, 0.9);
      const score = ratio * Math.sqrt(border);
      if (!best || score > best.score) {
        best = { neighborId, ratio, border, score, warChance, netBenefit, projectedGain, peaceTradeLoss, valuedTargets };
      }
    }
    if (best) state.fronts.set(entry.id, best);
  }
}

function estimateProvinceValue(attacker, targetIdx) {
  const target = getCellByIdx(targetIdx);
  const annexFriendly = neighbors4(target.x, target.y)
    .map(([nx, ny]) => getCell(nx, ny))
    .filter((neighbor) => !neighbor.isWater && neighbor.ownerId === attacker.id).length;
  const distance = manhattan(targetIdx, attacker.capitalIdx);
  const capitalTaxFactor = calculateCapitalTaxFactor(distance, attacker.cells.size + 1);
  const weatherFactor = 1 - target.rainPenalty;
  const tradePotential = target.resource * CONFIG.tradeBonus * ((annexFriendly + 1) / 4);
  return (target.resource + tradePotential) * attacker.economicModifier * capitalTaxFactor * weatherFactor;
}

function chooseBattlePath(attackerId, defenderId, preferredTargets) {
  const attacker = state.states.get(attackerId);
  const targets = preferredTargets.filter((idx) => {
    const cell = getCellByIdx(idx);
    return cell && !cell.isWater && cell.ownerId === defenderId;
  });
  if (targets.length > 0) return { targetIdx: targets[randomInt(0, targets.length - 1)] };

  for (const idx of attacker.cells) {
    const cell = getCellByIdx(idx);
    const localTargets = neighbors4(cell.x, cell.y)
      .map(([nx, ny]) => getCell(nx, ny))
      .filter((n) => !n.isWater && n.ownerId === defenderId);
    if (localTargets.length > 0) {
      const target = localTargets[randomInt(0, localTargets.length - 1)];
      return { targetIdx: keyOf(target.x, target.y) };
    }
  }
  return null;
}

function transferCell(idx, attackerId) {
  const cell = getCellByIdx(idx);
  setCellOwner(cell, attackerId);
  cell.isCapital = false;
  cell.flash = 7;
}

function mutateColor(color) {
  const match = /hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/.exec(color);
  if (!match) return colorForState(state.nextStateId);
  const hue = (Number(match[1]) + randomInt(24, 56)) % 360;
  const sat = clamp(Number(match[2]) + randomInt(-8, 9), 45, 82);
  const light = clamp(Number(match[3]) + randomInt(-7, 7), 36, 68);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function createStateFromComponent(component, sourceId) {
  const id = state.nextStateId++;
  const capitalIdx = chooseCapital(component);
  const entry = createStateRecord(id, capitalIdx);
  const source = state.states.get(sourceId);
  entry.color = source ? mutateColor(source.color) : colorForState(id);
  state.states.set(id, entry);
  for (const idx of component) {
    const cell = getCellByIdx(idx);
    setCellOwner(cell, id);
    cell.isCapital = false;
  }
  getCellByIdx(capitalIdx).isCapital = true;
  state.totalBirths += 1;
  return entry;
}

function removeState(id) {
  const entry = state.states.get(id);
  if (!entry || !entry.alive) return;
  entry.alive = false;
  state.totalDeaths += 1;
}

function processCapitalFall(defenderId, attackerId, capitalIdx) {
  const defender = state.states.get(defenderId);
  if (!defender) return;
  const remaining = new Set(defender.cells);
  remaining.delete(capitalIdx);
  transferCell(capitalIdx, attackerId);
  const viable = [];
  for (const component of connectedComponents(remaining)) {
    if (component.size >= CONFIG.secessionMinSize) viable.push(component);
    else for (const idx of component) transferCell(idx, attackerId);
  }
  viable.sort((a, b) => b.size - a.size);
  for (const component of viable.slice(0, 2)) createStateFromComponent(component, defenderId);
  for (const extra of viable.slice(2)) for (const idx of extra) transferCell(idx, attackerId);
  pushEvent(`${defender.name} colapsa tras la caída de su capital.`);
  removeState(defenderId);
}

function processProvinceLoss(defenderId, attackerId, targetIdx) {
  const defender = state.states.get(defenderId);
  if (!defender) return;
  transferCell(targetIdx, attackerId);
  const remaining = new Set(defender.cells);
  remaining.delete(targetIdx);
  if (remaining.size === 0) {
    removeState(defenderId);
    return;
  }
  const components = connectedComponents(remaining);
  const capitalComponent = components.find((component) => component.has(defender.capitalIdx));
  if (!capitalComponent || capitalComponent.size === remaining.size) return;
  for (const component of components.filter((component) => !component.has(defender.capitalIdx))) {
    if (component.size >= CONFIG.secessionMinSize && component.size >= Math.max(6, Math.floor(defender.cells.size * 0.24))) createStateFromComponent(component, defenderId);
    else for (const idx of component) transferCell(idx, attackerId);
  }
}

function processClaim(claim) {
  const defender = state.states.get(claim.defenderId);
  if (!defender || !defender.alive) return;
  const target = getCellByIdx(claim.targetIdx);
  if (!target || target.isWater || target.ownerId !== claim.defenderId) return;
  if (target.isCapital || claim.targetIdx === defender.capitalIdx) processCapitalFall(claim.defenderId, claim.attackerId, claim.targetIdx);
  else processProvinceLoss(claim.defenderId, claim.attackerId, claim.targetIdx);
}

function findRemoteSecessionComponent(entry) {
  const minSize = Math.max(CONFIG.secessionMinSize, Math.floor(entry.cells.size * 0.05));
  if (entry.cells.size < minSize * 2.5) return null;
  const remoteThreshold = Math.max(entry.avgDistance * 1.18, Math.sqrt(entry.cells.size) * 1.3);
  const remoteMask = new Set();
  for (const idx of entry.cells) {
    if (idx === entry.capitalIdx) continue;
    const cell = getCellByIdx(idx);
    const disloyalty = 1 - cell.ownerRecentShare;
    if (cell.capitalDistance >= remoteThreshold && disloyalty >= 0.06) remoteMask.add(idx);
  }
  if (remoteMask.size < minSize) return null;
  let weightedDistance = 0;
  let weightedDisloyalty = 0;
  for (const idx of remoteMask) {
    const cell = getCellByIdx(idx);
    weightedDistance += Math.pow(cell.capitalDistance / Math.max(1, remoteThreshold), 1.7);
    weightedDisloyalty += Math.pow(1 - cell.ownerRecentShare, 1.35);
  }
  const remoteShare = remoteMask.size / entry.cells.size;
  const distanceWeight = weightedDistance / Math.max(1, remoteMask.size);
  const disloyaltyWeight = weightedDisloyalty / Math.max(1, remoteMask.size);
  const sizeFactor = clamp(entry.cells.size / 22, 1, 18);
  const distanceFactor = clamp(Math.pow(distanceWeight, 1.55) * (entry.maxDistance / Math.max(4, entry.avgDistance * 1.1)), 1, 14);
  const consolidationFactor = clamp(0.18 + disloyaltyWeight * 2.6, 0.18, 2.6);
  const chance = clamp(CONFIG.remoteSecessionChance * sizeFactor * (0.45 + remoteShare * 2.4) * distanceFactor * consolidationFactor, 0, 0.6);
  if (Math.random() >= chance) return null;
  const components = connectedComponents(remoteMask).filter((component) => component.size >= minSize);
  if (components.length === 0) return null;
  components.sort((a, b) => scoreRemoteComponent(b, remoteThreshold) - scoreRemoteComponent(a, remoteThreshold));
  return components[0];
}

function scoreRemoteComponent(component, remoteThreshold) {
  let score = 0;
  for (const idx of component) {
    const cell = getCellByIdx(idx);
    score += Math.pow(cell.capitalDistance / Math.max(1, remoteThreshold), 1.9) * Math.pow(1 - cell.ownerRecentShare, 1.4);
  }
  return score / Math.max(1, component.size);
}

function resolveRemoteSecessions() {
  for (const entry of getAliveStates()) {
    const component = findRemoteSecessionComponent(entry);
    if (!component) continue;
    const newborn = createStateFromComponent(component, entry.id);
    pushEvent(`${newborn.name} se escinde de ${entry.name}.`);
  }
}

function decayWeather() {
  for (const cell of state.grid) {
    if (cell.rainTurns <= 0) continue;
    cell.rainTurns -= 1;
    if (cell.rainTurns <= 0) {
      cell.rainTurns = 0;
      cell.rainPenalty = 0;
    }
  }
}

function resolveCampaigns() {
  const claims = [];
  for (const actor of getAliveStates()) {
    const front = state.fronts.get(actor.id);
    if (!front || front.ratio < CONFIG.attackThreshold) continue;
    const enemy = state.states.get(front.neighborId);
    if (!enemy || !enemy.alive) continue;
    if (Math.random() >= front.warChance) continue;
    const strikes = clamp(1 + Math.floor((front.ratio - CONFIG.attackThreshold) / 0.45), 1, CONFIG.maxBreakthrough);
    const preferredTargets = front.valuedTargets.slice(0, Math.max(1, strikes + 1)).map((target) => target.targetIdx);
    const seenTargets = new Set();
    for (let i = 0; i < strikes; i += 1) {
      const path = chooseBattlePath(actor.id, enemy.id, preferredTargets);
      if (!path || seenTargets.has(path.targetIdx)) continue;
      seenTargets.add(path.targetIdx);
      const attackShock = Math.max(0.08, 1 + randomFloat(-CONFIG.battleVolatility, CONFIG.battleVolatility) + randomFloat(-CONFIG.battleVolatility, CONFIG.battleVolatility));
      const defenseShock = Math.max(0.08, 1 + randomFloat(-CONFIG.battleVolatility, CONFIG.battleVolatility) + randomFloat(-CONFIG.battleVolatility, CONFIG.battleVolatility));
      const attackStrength = actor.totalPower * randomFloat(0.28, 1.92) * attackShock;
      const defendStrength = enemy.totalPower * randomFloat(0.34, 1.88) * defenseShock;
      if (attackStrength > defendStrength) claims.push({ attackerId: actor.id, defenderId: enemy.id, targetIdx: path.targetIdx });
    }
  }
  return claims;
}

function computePolarity(aliveStates) {
  const totalCells = aliveStates.reduce((sum, entry) => sum + entry.cells.size, 0);
  if (totalCells === 0) return 0;
  const concentration = aliveStates.reduce((sum, entry) => {
    const share = entry.cells.size / totalCells;
    return sum + share * share;
  }, 0);
  if (concentration <= 0) return 0;
  return 1 / concentration;
}

function countCampaigns() {
  let total = 0;
  for (const entry of getAliveStates()) {
    const front = state.fronts.get(entry.id);
    if (front && front.ratio >= CONFIG.attackThreshold && front.warChance >= 0.12) total += 1;
  }
  return total;
}

function pushEvent(text) {
  state.events.unshift({ turn: state.turn, text });
  state.events = state.events.slice(0, 10);
}

function getSnapshot() {
  const alive = getAliveStates().sort((a, b) => b.cells.size - a.cells.size);
  const stateMeta = {};
  for (const entry of alive) {
    stateMeta[entry.id] = { name: entry.name, color: entry.color };
  }
  return {
    phase: state.phase,
    paused: state.paused,
    turn: state.turn,
    aliveCount: alive.length,
    polarity: computePolarity(alive),
    campaignCount: countCampaigns(),
    topStates: alive.slice(0, 6).map((entry) => ({
      id: entry.id,
      name: entry.name,
      color: entry.color,
      cells: entry.cells.size,
      power: entry.totalPower,
      capitalIdx: entry.capitalIdx
    })),
    events: state.events.slice(0, 8),
    stateMeta,
    cells: state.grid.map((cell) => ({
      x: cell.x,
      y: cell.y,
      ownerId: cell.ownerId,
      resource: cell.resource,
      isWater: cell.isWater,
      isCapital: cell.isCapital,
      flash: cell.flash,
      effectiveResource: cell.effectiveResource,
      capitalDistance: cell.capitalDistance,
      capitalTaxFactor: cell.capitalTaxFactor,
      ownerRecentShare: cell.ownerRecentShare,
      rainTurns: cell.rainTurns,
      rainPenalty: cell.rainPenalty
    }))
  };
}

function emitSnapshot() {
  postMessage({ type: "snapshot", snapshot: getSnapshot() });
}

function runTick() {
  if (state.phase !== "simulation" || state.paused) return;
  updateOwnershipMemory();
  updateStates();
  resolveRemoteSecessions();
  updateStates();
  const claims = resolveCampaigns();
  const campaignSet = new Set(claims.map((claim) => warKey(claim.attackerId, claim.defenderId)));
  for (const claim of claims) processClaim(claim);
  decayWeather();
  updateStates();
  state.turn += 1;
  state.lastCampaignCount = campaignSet.size;
  emitSnapshot();
}

function restartInterval() {
  if (state.intervalId) clearInterval(state.intervalId);
  state.intervalId = setInterval(runTick, Math.max(16, Math.round(1000 / CONFIG.tickRate)));
}

function applyRain(x, y) {
  const radius = Math.max(1, CONFIG.brushRadius);
  for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
    for (let dx = -radius + 1; dx <= radius - 1; dx += 1) {
      if (dx * dx + dy * dy > (radius - 0.25) * (radius - 0.25)) continue;
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || px >= CONFIG.width || py < 0 || py >= CONFIG.height) continue;
      const cell = getCell(px, py);
      if (cell.isWater) continue;
      cell.rainTurns = Math.max(cell.rainTurns, CONFIG.rainDuration);
      cell.rainPenalty = Math.max(cell.rainPenalty, CONFIG.rainStrength);
      cell.flash = 5;
    }
  }
  emitSnapshot();
}

function buildGrid(gridSeed) {
  state.grid = [];
  state.states = new Map();
  state.fronts = new Map();
  state.turn = 0;
  state.events = [];
  state.totalBirths = 0;
  state.totalDeaths = 0;
  state.nextStateId = 1;
  for (let y = 0; y < CONFIG.height; y += 1) {
    for (let x = 0; x < CONFIG.width; x += 1) {
      state.grid.push(createCell(x, y, gridSeed ? gridSeed[keyOf(x, y)] : null));
    }
  }
}

function start(gridSeed) {
  buildGrid(gridSeed);
  state.phase = "simulation";
  state.paused = false;
  for (const cell of state.grid) {
    if (cell.isWater) continue;
    if (cell.resource <= 0) cell.resource = 3;
    const id = state.nextStateId++;
    setCellOwner(cell, id);
    cell.ownerRecentShare = 1;
    cell.isCapital = true;
    state.states.set(id, createStateRecord(id, keyOf(cell.x, cell.y)));
  }
  updateStates();
  pushEvent("Estado de naturaleza: cada celda terrestre empieza como microestado.");
  emitSnapshot();
}

onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      CONFIG = { ...message.config };
      buildGrid();
      state.phase = "editor";
      state.paused = true;
      restartInterval();
      postMessage({ type: "ready" });
      break;
    case "start":
      start(message.gridSeed);
      restartInterval();
      break;
    case "pause":
      state.paused = true;
      emitSnapshot();
      break;
    case "resume":
      state.paused = false;
      emitSnapshot();
      break;
    case "step":
      if (state.phase === "simulation") {
        state.paused = true;
        runTick();
      }
      break;
    case "rain":
      if (state.phase === "simulation") applyRain(message.x, message.y);
      break;
    case "reset":
      buildGrid();
      state.phase = "editor";
      state.paused = true;
      emitSnapshot();
      break;
    case "config":
      CONFIG = { ...CONFIG, ...message.config };
      restartInterval();
      emitSnapshot();
      break;
    default:
      break;
  }
};
