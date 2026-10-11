import type { Manifest } from "../../types/data";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Attribution HTML for the railway data (MapLibre renders it as HTML). */
export function buildDataAttribution(manifest: Manifest): string {
  const { attribution, license } = manifest.source;
  return `${escapeHtml(attribution)}（${escapeHtml(license)}）`;
}

/** `url` when it is an absolute http(s) URL, else null (never a javascript: link). */
export function safeExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}
