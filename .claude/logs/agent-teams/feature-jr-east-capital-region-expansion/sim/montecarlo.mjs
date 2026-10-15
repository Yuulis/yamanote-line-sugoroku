// Monte Carlo game-length study for the JR East 1都3県 edition (architect scratch tool,
// not product code). Reproduces the engine's turn rules (design §1 of
// jr-east-tokyo-expansion-design.md) on an arbitrary service network and adds
// candidate game-length levers.
//
// Usage: node montecarlo.mjs <network.json> [--games N] [--seed S] [--cap C] [--rules name,...]
// network.json: { label, target, start, services: [{ id, type, circular, stops: [stationKey...] }],
//                 prefectures?: { stationKey: "東京都" | ... } }

import { readFileSync } from "node:fs";

// ---------- PRNG: sfc32 seeded by a 32-bit integer (distributional study only) ----------
function makeRng(seed) {
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = seed >>> 0;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i += 1) next();
  return next;
}

// ---------- Network ----------
function buildNetwork(raw) {
  const stationIndex = new Map();
  const stationNames = [];
  const idOf = (key) => {
    if (!stationIndex.has(key)) {
      stationIndex.set(key, stationNames.length);
      stationNames.push(key);
    }
    return stationIndex.get(key);
  };
  const services = raw.services.map((s) => {
    const stops = s.stops.map(idOf);
    if (new Set(stops).size !== stops.length) throw new Error(`repeated stop in ${s.id}`);
    const pos = new Map(stops.map((st, i) => [st, i]));
    return { id: s.id, type: s.type ?? "local", circular: !!s.circular, stops, pos };
  });
  const n = stationNames.length;
  const servicesAt = Array.from({ length: n }, () => []);
  services.forEach((s, si) => s.stops.forEach((st) => servicesAt[st].push(si)));
  const target = services.findIndex((s) => s.id === raw.target);
  if (target < 0) throw new Error("target service missing");
  const start = stationIndex.get(raw.start);
  if (start === undefined) throw new Error("start station missing");
  const tgt = services[target];
  // BFS hop distance (over all services' adjacent stops) from the target loop.
  const adj = Array.from({ length: n }, () => new Set());
  for (const s of services) {
    const m = s.stops.length;
    const pairs = s.circular ? m : m - 1;
    for (let i = 0; i < pairs; i += 1) {
      const u = s.stops[i], v = s.stops[(i + 1) % m];
      adj[u].add(v); adj[v].add(u);
    }
  }
  const dist = new Array(n).fill(Infinity);
  const queue = [];
  for (const st of tgt.stops) { dist[st] = 0; queue.push(st); }
  for (let qi = 0; qi < queue.length; qi += 1) {
    const u = queue[qi];
    for (const v of adj[u]) if (dist[v] === Infinity) { dist[v] = dist[u] + 1; queue.push(v); }
  }
  const unreachable = stationNames.filter((_, i) => dist[i] === Infinity);
  const pref = raw.prefectures ? stationNames.map((k) => raw.prefectures[k] ?? null) : null;
  return { stationNames, services, servicesAt, target, start, dist, unreachable, pref, n };
}

function nextStop(svc, station, dir) {
  const i = svc.pos.get(station);
  const j = i + dir;
  if (svc.circular) return svc.stops[(j + svc.stops.length) % svc.stops.length];
  return j >= 0 && j < svc.stops.length ? svc.stops[j] : -1;
}

// ---------- Rules ----------
// Each rule: { goal: "y30" | "yStations" | "pref4" , policy: "truncate"|"pass"|"exact",
//   targetWeight, targetShare, inboundWeight, keepDirection, localWeight, rapidWeight, requiredSegments }
const BASE = {
  goal: "y30", policy: "truncate", targetWeight: 1, targetShare: 0,
  inboundWeight: 1, keepDirection: false, localWeight: 1, rapidWeight: 1, requiredSegments: null,
};
export const RULES = {
  baseline: {},
  pass: { policy: "pass" },
  yw2: { targetWeight: 2 },
  yw3: { targetWeight: 3 },
  yhalf: { targetShare: 0.5 },
  yhalfPass: { targetShare: 0.5, policy: "pass" },
  inbound2: { inboundWeight: 2 },
  inbound3: { inboundWeight: 3 },
  yhalfInbound2: { targetShare: 0.5, inboundWeight: 2 },
  yhalfInbound2Pass: { targetShare: 0.5, inboundWeight: 2, policy: "pass" },
  keepDir: { keepDirection: true },
  yStations: { goal: "yStations" },
  yStationsPass: { goal: "yStations", policy: "pass" },
  pref4Pass: { goal: "pref4", policy: "pass" },
  pref4yhalfPass: { goal: "pref4", policy: "pass", targetShare: 0.5 },
  y15: { requiredSegments: 15 },
  rapidHalf: { localWeight: 2, rapidWeight: 1 },
  ythirdInbound2: { targetShare: 1 / 3, inboundWeight: 2 },
  ythird: { targetShare: 1 / 3 },
  yhalfInbound3: { targetShare: 0.5, inboundWeight: 3 },
  yw3Inbound2: { targetWeight: 3, inboundWeight: 2 },
  yhalfInbound2Rapid: { targetShare: 0.5, inboundWeight: 2, localWeight: 2, rapidWeight: 1 },
  passInbound2: { policy: "pass", inboundWeight: 2 },
};

function weightedPick(rng, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

function playGame(net, rule, rng, cap) {
  const { services, servicesAt, target, start, dist } = net;
  const tgt = services[target];
  const nTarget = tgt.stops.length;
  // Target segment index = position of its `from` stop on the loop (+1 direction).
  const done = new Uint8Array(nTarget);
  let doneCount = 0;
  const visitedTarget = new Uint8Array(nTarget);
  let visitedCount = 0;
  const prefSeen = new Set();
  const markVisit = (st) => {
    if (rule.goal === "yStations") {
      const p = tgt.pos.get(st);
      if (p !== undefined && !visitedTarget[p]) { visitedTarget[p] = 1; visitedCount += 1; }
    } else if (rule.goal === "pref4" && net.pref) {
      const p = net.pref[st];
      if (p) prefSeen.add(p);
    }
  };
  const required = rule.requiredSegments ?? nTarget;
  const goalSatisfied = () => {
    if (rule.goal === "y30") return doneCount >= required;
    if (rule.goal === "yStations") return visitedCount >= nTarget;
    if (rule.goal === "pref4") return prefSeen.size >= 4;
    throw new Error("unknown goal");
  };
  let station = start, svc = target, dir = 1;
  markVisit(station);
  let lotteries = 0, turnsOnTarget = 0, completedAt = -1;
  for (let turn = 1; turn <= cap; turn += 1) {
    const roll = 1 + Math.floor(rng() * 6);
    const service = services[svc];
    if (svc === target) turnsOnTarget += 1;
    let cleared = false;
    for (let step = 1; step <= roll; step += 1) {
      const nx = nextStop(service, station, dir);
      if (nx < 0) break; // endpoint: discard the rest
      if (svc === target) {
        const p = tgt.pos.get(station);
        if (!done[p]) { done[p] = 1; doneCount += 1; }
      }
      station = nx;
      markVisit(station);
      if (completedAt < 0 && goalSatisfied()) completedAt = turn;
      if (station === start && goalSatisfied()) {
        const last = step === roll;
        const stops = last || rule.policy === "pass" || (rule.policy === "truncate" && svc === target);
        if (stops) { cleared = true; break; }
      }
    }
    if (cleared) return { turns: turn, lotteries, turnsOnTarget, completedAt };
    // Landing.
    const cands = servicesAt[station];
    let chosen = svc;
    if (cands.length >= 2) {
      lotteries += 1;
      // One weighted draw (engine policy): base weight b_i per service kind; target-share p/q gives
      // the target p * sum(b_others) and every other candidate (q - p) * b_i; otherwise target = targetWeight.
      const base = (c) => (services[c].type === "local" ? rule.localWeight : rule.rapidWeight);
      let weights;
      if (rule.targetShare > 0 && cands.includes(target)) {
        const others = cands.filter((c) => c !== target).reduce((sum, c) => sum + base(c), 0);
        weights = cands.map((c) => (c === target ? (rule.targetShare / (1 - rule.targetShare)) * others : base(c)));
      } else {
        weights = cands.map((c) => (c === target ? rule.targetWeight * base(c) : base(c)));
      }
      chosen = cands[weightedPick(rng, weights)];
    }
    let newDir;
    if (chosen === target) newDir = 1;
    else {
      const cs = services[chosen];
      const dirs = [1, -1].filter((d) => nextStop(cs, station, d) >= 0);
      if (dirs.length === 1) newDir = dirs[0];
      else if (rule.keepDirection && cands.length === 1) newDir = dir; // R1-b: keep at k = 1
      else if (rule.inboundWeight !== 1) {
        const dPlus = dist[nextStop(cs, station, 1)], dMinus = dist[nextStop(cs, station, -1)];
        const w = [dPlus < dMinus ? rule.inboundWeight : 1, dMinus < dPlus ? rule.inboundWeight : 1];
        newDir = dirs[weightedPick(rng, w)];
        lotteries += 1;
      } else {
        newDir = rng() < 0.5 ? 1 : -1;
        lotteries += 1;
      }
    }
    svc = chosen; dir = newDir;
  }
  return { turns: Infinity, lotteries, turnsOnTarget, completedAt };
}

function quantile(sorted, q) {
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function simulate(net, ruleName, { games, seed, cap }) {
  const rule = { ...BASE, ...RULES[ruleName] };
  const rng = makeRng(seed);
  const turns = [];
  const endgame = [];
  let lotteries = 0, onTarget = 0, totalTurns = 0, capped = 0;
  for (let g = 0; g < games; g += 1) {
    const r = playGame(net, rule, rng, cap);
    if (r.turns === Infinity) { capped += 1; turns.push(cap + 1); continue; }
    turns.push(r.turns);
    endgame.push(r.turns - r.completedAt);
    lotteries += r.lotteries; onTarget += r.turnsOnTarget; totalTurns += r.turns;
  }
  turns.sort((x, y) => x - y);
  endgame.sort((x, y) => x - y);
  const finished = games - capped;
  const frac = (t) => (turns.filter((x) => x > t).length / games) * 100;
  return {
    rule: ruleName, games, seed, cap,
    median: quantile(turns, 0.5), p90: quantile(turns, 0.9), p99: quantile(turns, 0.99),
    mean: finished ? turns.filter((t) => t <= cap).reduce((a, b) => a + b, 0) / finished : NaN,
    over200: frac(200), over500: frac(500), over1000: frac(1000), capExceeded: (capped / games) * 100,
    over500Count: turns.filter((x) => x > 500).length, max: turns[turns.length - 1],
    endgameMedian: endgame.length ? quantile(endgame, 0.5) : NaN,
    endgameP90: endgame.length ? quantile(endgame, 0.9) : NaN,
    lotteriesPerGame: finished ? lotteries / finished : NaN,
    targetTurnShare: totalTurns ? (onTarget / totalTurns) * 100 : NaN,
  };
}

function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const games = Number(opt("games", 20000));
  const seed = Number(opt("seed", 20261012));
  const cap = Number(opt("cap", 5000));
  const ruleNames = opt("rules", "baseline").split(",");
  const net = buildNetwork(JSON.parse(readFileSync(file, "utf8")));
  const transfer = net.servicesAt.filter((s) => s.length >= 2).length;
  const kMax = Math.max(...net.servicesAt.map((s) => s.length));
  const kTop = net.servicesAt
    .map((s, i) => [net.stationNames[i], s.length])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  console.log(JSON.stringify({
    network: { stations: net.n, services: net.services.length, transferStations: transfer, kMax, kTop,
      startK: net.servicesAt[net.start].length, unreachableFromTarget: net.unreachable.length },
  }));
  for (const name of ruleNames) {
    const r = simulate(net, name, { games, seed, cap });
    console.log(JSON.stringify(r));
  }
}

main();
