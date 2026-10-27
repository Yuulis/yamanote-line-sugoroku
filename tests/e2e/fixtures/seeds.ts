// First item-rule fixture seed found by the ascending 128-bit hex search
// documented in tests/unit/e2e-fixture-seeds.test.ts.
export const FIXTURE_GAME_SEED = "000000000000000000000000000005ff";
export const FIXTURE_SCENARIO_TURNS = {
  transfer: 1,
  boundary: 2,
  terminus: 3,
  direction: 5,
  completed: 14,
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

// Ascending 128-bit-hex searches with item rules over the 135-service bundle,
// proved in tests/unit/real-data-e2e-scenarios.test.ts.
export const PRODUCT_HUB_GAME_SEED = "00000000000000000000000000000009";
export const PRODUCT_COMPOSED_GAME_SEED = "00000000000000000000000000000008";
export const PRODUCT_HISTORY_GAME_SEED = "00000000000000000000000000000000";
export const PRODUCT_UENO_TRANSFER_SEED = "00000000000000000000000000000013";
export const PRODUCT_KORAKUEN_TRANSFER_SEED = "00000000000000000000000000000011";
export const PRODUCT_KORAKUEN_TRANSFER_TURN = 13;
export const PRODUCT_COMPOSED_SCENARIO_TURNS = { forward: 148, reverse: 177 } as const;
export const PRODUCT_HISTORY_SCENARIO_TURNS = { completed: 96 } as const;

export const PRODUCT_OEDO_GAME_SEED = "00000000000000000000000000000004";
export const PRODUCT_OEDO_LOTTERY_TURN = 256;
