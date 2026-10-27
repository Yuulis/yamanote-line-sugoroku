import type { TurnStatistics } from "../harness";
import type { Policy } from "./policy";

export const REFERENCE = {
  greedy: { median: 65, p90: 143, p99: 241, max: 433, over500Share: 0 },
  random: { median: 113, p90: 232, p99: 370, max: 565, over500Share: 0.0012 },
} as const;

/** Predeclared thresholds; maximum is deliberately diagnostic only. */
export function parityVerdict(policy: Policy, statistics: TurnStatistics): { pass: boolean; checks: Record<string, boolean> } {
  const reference = REFERENCE[policy];
  const checks = {
    median: Math.abs(statistics.median - reference.median) <= Math.max(5, reference.median * 0.1),
    p90: Math.abs(statistics.p90 - reference.p90) <= Math.max(10, reference.p90 * 0.1),
    p99: Math.abs(statistics.p99 - reference.p99) <= Math.max(20, reference.p99 * 0.1),
    p99Below400: statistics.p99 < 400,
    over500: statistics.over500Count / statistics.games <= 0.005,
    noCaps: statistics.capHits === 0,
    completion: statistics.completedGames === statistics.games,
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

export function envInteger(name: string, fallback: number, minimum: number = 1): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be a safe integer >= ${minimum}`);
  return value;
}
