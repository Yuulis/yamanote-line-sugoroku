// First production-rule fixture seed found by the ascending 128-bit hex search
// documented in tests/unit/e2e-fixture-seeds.test.ts.
export const FIXTURE_GAME_SEED = "00000000000000000000000000000398";
export const FIXTURE_SCENARIO_TURNS = {
  transfer: 1,
  boundary: 2,
  terminus: 3,
  direction: 5,
  completed: 13,
} as const;

// Retained for explicitly legacy-rule trajectory and presentation regressions.
export const LEGACY_FIXTURE_GAME_SEED = "00000000000000000000000000000009";
export const LEGACY_FIXTURE_SCENARIO_TURNS = {
  transfer: 1,
  boundary: 2,
  terminus: 3,
  direction: 8,
  completed: 15,
} as const;

// Ascending 128-bit-hex searches over the current 135-service product bundle,
// proved in tests/unit/real-data-e2e-scenarios.test.ts.
export const PRODUCT_HUB_GAME_SEED = "00000000000000000000000000000009";
export const PRODUCT_COMPOSED_GAME_SEED = "00000000000000000000000000000007";
export const PRODUCT_HISTORY_GAME_SEED = "00000000000000000000000000000000";
export const PRODUCT_UENO_TRANSFER_SEED = "00000000000000000000000000000011";
export const PRODUCT_KORAKUEN_TRANSFER_SEED = "0000000000000000000000000000003b";
export const PRODUCT_KORAKUEN_TRANSFER_TURN = 13;
export const PRODUCT_COMPOSED_SCENARIO_TURNS = { forward: 9, reverse: 16 } as const;
export const PRODUCT_HISTORY_SCENARIO_TURNS = { completed: 42 } as const;
