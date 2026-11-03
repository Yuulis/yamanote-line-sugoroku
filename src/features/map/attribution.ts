import type { Manifest } from "../../types/data";

/** MapLibre's attribution control container and its compact toggle (public DOM classes). */
export const ATTRIBUTION_SELECTOR = ".maplibregl-ctrl-attrib";
const ATTRIBUTION_TOGGLE_SELECTOR = ".maplibregl-ctrl-attrib-button";
const COMPACT_CLASS = "maplibregl-compact";
const EXPANDED_CLASS = "maplibregl-compact-show";

/**
 * Bottom edge (viewport px) of the top-left attribution (phones and short
 * landscape), collapsed or expanded, published on the document root so the
 * phone toast stack can start below it. Unset while no control is watched.
 */
export const ATTRIBUTION_BOTTOM_PROPERTY = "--map-attribution-bottom";

function isExpandedAttribution(container: HTMLElement): boolean {
  return container.classList.contains(COMPACT_CLASS) && container.classList.contains(EXPANDED_CLASS);
}

/**
 * Collapse MapLibre's compact attribution by activating its own toggle, only
 * when it is currently expanded. Returns whether it collapsed it.
 */
export function collapseAttributionOnce(container: HTMLElement): boolean {
  if (!isExpandedAttribution(container)) return false;
  const toggle = container.querySelector<HTMLElement>(ATTRIBUTION_TOGGLE_SELECTOR);
  if (!toggle) return false;
  toggle.click();
  return true;
}

/**
 * Phone and short-landscape behaviour for one attached attribution control:
 * collapse it once as soon as it shows expanded (at attach time, or when its
 * content first populates), never after the user has used the toggle, and
 * publish its bottom edge (collapsed or expanded). Returns the cleanup for
 * detach/unmount.
 */
export function watchCompactAttribution(
  container: HTMLElement,
  root: HTMLElement = document.documentElement,
): () => void {
  let collapsePending = true;
  let autoToggling = false;

  const publishBottom = (): void => {
    if (!container.isConnected) {
      root.style.removeProperty(ATTRIBUTION_BOTTOM_PROPERTY);
      return;
    }
    const bottom: number = Math.ceil(container.getBoundingClientRect().bottom);
    root.style.setProperty(ATTRIBUTION_BOTTOM_PROPERTY, `${bottom}px`);
  };
  const attemptCollapse = (): void => {
    if (!collapsePending) return;
    autoToggling = true;
    try {
      if (collapseAttributionOnce(container)) collapsePending = false;
    } finally {
      autoToggling = false;
    }
  };
  // Capture phase: runs before MapLibre's own toggle handler on the summary.
  const onClick = (event: MouseEvent): void => {
    if (autoToggling) return;
    if (event.target instanceof Element && event.target.closest(ATTRIBUTION_TOGGLE_SELECTOR)) {
      collapsePending = false;
    }
  };
  const update = (): void => {
    attemptCollapse();
    publishBottom();
  };

  // MapLibre's click handler flips the class first; the native <summary> toggles
  // `open` (which renders the credit) only afterwards, so a class-only observer
  // would publish the collapsed bottom for an expanding control until the next
  // ResizeObserver delivery. Observing `open` too settles it in the same task.
  const mutationObserver = new MutationObserver(update);
  mutationObserver.observe(container, { attributes: true, attributeFilter: ["class", "open"] });
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publishBottom);
  resizeObserver?.observe(container);
  container.addEventListener("click", onClick, true);
  // A rotation can move the control (safe-area insets) without resizing it.
  window.addEventListener("resize", publishBottom);
  update();

  return () => {
    mutationObserver.disconnect();
    resizeObserver?.disconnect();
    container.removeEventListener("click", onClick, true);
    window.removeEventListener("resize", publishBottom);
    root.style.removeProperty(ATTRIBUTION_BOTTOM_PROPERTY);
  };
}

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
