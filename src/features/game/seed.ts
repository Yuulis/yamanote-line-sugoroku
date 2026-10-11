const SEED_BYTES = 16;
const HEX_RADIX = 16;

/** A fresh 128-bit hex seed from the platform CSPRNG (kept outside the engine). */
export function generateSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(2, "0")).join("");
}
