// Exact 128-bit game seed, shared by the browser installer and Vitest proofs.
export const FIXTURE_GAME_SEED = "00000000000000000000000000000009";
export const FIXTURE_SCENARIO_TURNS = {
  transfer: 1,
  boundary: 2,
  terminus: 3,
  direction: 8,
  completed: 15,
} as const;
