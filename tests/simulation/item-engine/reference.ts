// Diagnostic-only instrumentation of the frozen spike. Never used to drive
// production decisions, movement, landing or drops. Generated copy stays ignored.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RailwayNetwork } from "../../../src/features/game/engine";
import { CLASSIC_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import type { TurnTrace } from "./runner";

interface ReferenceModule {
  referenceTrace: TurnTrace[];
  WEIGHTINGS: { id: string }[];
  makeContext: (network: RailwayNetwork, config: typeof CLASSIC_GAME_CONFIG, weighting: unknown) => unknown;
  runItemGame: (context: unknown, variant: unknown, seed: string, cap: number) => { turns: number; completed: boolean };
}

export async function loadReference(network: RailwayNetwork): Promise<{ run: (seed: string, cap: number) => { turns: number; completed: boolean; trace: TurnTrace[] } }> {
  const spikePath = resolve("tests/simulation/item-spike/sim.ts");
  let source = readFileSync(spikePath, "utf8");
  const replace = (before: string, after: string): void => {
    if (source.split(before).length !== 2) throw new Error(`Frozen reference instrumentation anchor changed: ${before}`);
    source = source.replace(before, after);
  };
  source = source.replaceAll('"../../../src/', `"${resolve("src")}/`).replace('"./moves"', `"${resolve("tests/simulation/item-spike/moves.ts")}"`);
  replace('export function runItemGame(', 'export let referenceTrace: unknown[] = [];\nexport function runItemGame(');
  replace('  const result = emptyResult();', '  referenceTrace = [];\n  const result = emptyResult();');
  replace('    const activeUsesBefore = result.used - result.usedByKind.certificate;', `    const activeUsesBefore = result.used - result.usedByKind.certificate;
    const fromStation = position.currentStationId;
    const fromService = position.currentServiceId;
    const routes = activeServices(ctx, items, position.currentStationId, turn);
    const beforeUses = { ...result.usedByKind };
    let traceRoll: number | null = null;
    let traceFace: number | null = null;
    let traceRide: string | null = null;
    let traceDirection: number | null = null;
    let traceMode = "deadhead";
    let traceHops = 0;
    const emit = (): void => {
      const names: Record<string, string> = { route: "route-ticket", direction: "direction-ticket", adjust: "roll-adjust", certificate: "delay-certificate" };
      const used = Object.keys(beforeUses).find((kind) => kind !== "certificate" && result.usedByKind[kind as BeneficialItem] > beforeUses[kind as BeneficialItem]);
      referenceTrace.push({ turn, station: position.currentStationId, service: position.currentServiceId,
        direction: position.direction, main, items: itemRng,
        inventory: items.inventory.map((kind) => names[kind] ?? kind),
        targets: position.completedSegmentIds.filter((id) => ctx.targetSegmentIds.has(id)),
        rawRoll: traceRoll, face: traceFace, action: used ? names[used] ?? used : null,
        ride: traceRide, mode: traceMode, hops: traceHops, fromStation, fromService, routes, rideDirection: traceDirection,
        effects: { delay: [...items.delayTurns].sort((a, b) => a - b),
          suspension: [...items.suspendedUntil].filter(([, expiry]) => expiry > turn).sort((a, b) => a[0].localeCompare(b[0])),
          detour: items.detourPending, oversleep: items.oversleepPending } });
    };`);
  replace('      policyRng = next.policyRng;\n    };', '      policyRng = next.policyRng;\n      emit();\n    };');
  replace('    if (ridden.currentServiceId === ctx.targetId) result.targetTurns += 1;', `    traceRoll = roll.value;
    traceFace = face;
    traceRide = ridden.currentServiceId;
    traceDirection = ridden.direction;
    traceMode = oversleep ? "oversleep" : plan.rapid ? "rapid" : "normal";
    traceHops = moved.traversedSegmentIds.length;
    if (ridden.currentServiceId === ctx.targetId) result.targetTurns += 1;`);
  replace('      break;\n    }\n    const landing = landingCandidates', '      emit();\n      break;\n    }\n    const landing = landingCandidates');
  const generated = resolve(".claude/logs/item-engine/reference-trace.ts");
  mkdirSync(resolve(".claude/logs/item-engine"), { recursive: true });
  writeFileSync(generated, source);
  const reference = await import(/* @vite-ignore */ generated) as ReferenceModule;
  const context = reference.makeContext(network, CLASSIC_GAME_CONFIG, reference.WEIGHTINGS.find((w) => w.id === "mild"));
  const variant = { weighting: "mild", dropPerMille: 300, harmfulPercent: 30, policy: "greedy", itemSet: "v2", r3: { singleItem: true, chooseDiscard: true } };
  return { run: (seed, cap) => {
    const result = reference.runItemGame(context, variant, seed, cap);
    return { ...result, trace: reference.referenceTrace };
  } };
}

export function firstDivergence(reference: readonly TurnTrace[], production: readonly TurnTrace[]): { turn: number; classification: string; fields: string[]; reference: TurnTrace | null; production: TurnTrace | null } | null {
  for (let index = 0; index < Math.max(reference.length, production.length); index += 1) {
    const left = reference[index];
    const right = production[index];
    if (!left || !right) return { turn: index + 1, classification: "history-length", fields: [], reference: left ?? null, production: right ?? null };
    const fields = (Object.keys(left) as (keyof TurnTrace)[]).filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
    if (fields.length === 0) continue;
    const oedo = left.mode === "oversleep" && left.ride === "toei-oedo-loop";
    const singletonRoute = left.action === "route-ticket" && right.action !== "route-ticket" && left.routes.length === 1 && left.routes[0] === "jr-yamanote";
    const classification = singletonRoute ? "singleton-route-eligibility" : oedo ? "oedo-oversleep-hop-limit" : fields.includes("action") ? "policy-decision" : fields.includes("rawRoll") ? "pre-roll-rng" : fields.includes("station") || fields.includes("hops") ? "movement" : fields.includes("service") || fields.includes("direction") || fields.includes("main") ? "landing" : fields.includes("items") || fields.includes("inventory") ? "drop-or-discard" : "movement-metadata";
    return { turn: index + 1, classification, fields, reference: left, production: right };
  }
  return null;
}
