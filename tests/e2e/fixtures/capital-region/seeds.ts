// Real engine proofs live in tests/unit/capital-region-scaling.test.ts.
// Replaced after the S5 rules flip. Search criterion: from 0x27c3, scan
// zero-padded 128-bit hex seeds in ascending numeric order; take the first that rolls 4 from the
// target to the rapid at 品川, rolls 2 to the rapid's south terminus, then rolls
// at least 3 back to 品川 and lands on owner A, and completes in 21-100 turns.
export const CAPITAL_GAME_SEED = "00000000000000000000000000012b1b";
// Search criterion: from 0, scan zero-padded hex seeds in ascending numeric order; take the
// first that satisfies the unit test's branch-boundary and fork-crossing conditions.
export const CAPITAL_BRANCH_SEED = "0000000000000000000000000000018e";
export const CAPITAL_SCENARIO_TURNS = { transfer: 1, rapidForward: 2, rapidReverse: 3, completed: 24 } as const;
