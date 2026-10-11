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

/** Licence name the manifest uses for CC BY 4.0, which gets a licence link. */
export const CC_BY_LICENSE_NAME = "CC BY 4.0";

/** CC BY 4.0 §3(a)(1)(C): the licence must be given as a URI or hyperlink. */
export const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/deed.ja";

/** `url` when it is an absolute https URL, else null (never a javascript: or http: link). */
export function safeExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Escaped text, wrapped in a new-tab link when `url` is a safe https URL. */
function linkOrText(text: string, url: string): string {
  const safeUrl = safeExternalUrl(url);
  const escapedText = escapeHtml(text);
  if (!safeUrl) return escapedText;
  return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapedText}</a>`;
}

/**
 * Attribution HTML for the railway data (MapLibre renders it as HTML): the
 * credit links to the dataset page and the licence to its CC BY 4.0 deed.
 */
export function buildDataAttribution(manifest: Manifest): string {
  const { attribution, license, url } = manifest.source;
  const licenseHtml =
    license === CC_BY_LICENSE_NAME ? linkOrText(license, CC_BY_URL) : escapeHtml(license);
  return `${linkOrText(attribution, url)}（${licenseHtml}）`;
}
