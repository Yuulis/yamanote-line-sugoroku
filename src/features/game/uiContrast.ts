export type RgbColor = [number, number, number];

const HEX_COLOR_PATTERN = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function parseHexColor(hex: string): RgbColor | null {
  if (!HEX_COLOR_PATTERN.test(hex)) {
    return null;
  }

  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  const expanded = normalized.length === 3
    ? [...normalized].map((digit: string) => `${digit}${digit}`).join("")
    : normalized;

  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function linearizeChannel(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const color = parseHexColor(hex);
  if (color === null) {
    return Number.NaN;
  }

  const [red, green, blue] = color;
  return 0.2126 * linearizeChannel(red)
    + 0.7152 * linearizeChannel(green)
    + 0.0722 * linearizeChannel(blue);
}

export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  if (Number.isNaN(firstLuminance) || Number.isNaN(secondLuminance)) {
    return Number.NaN;
  }

  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
