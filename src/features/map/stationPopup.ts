/** Build popup content with textContent only (no HTML injection). */
export function createStationPopupContent(
  name: string,
  lineNames: string,
): HTMLElement {
  const container = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = name;
  container.append(title);
  if (lineNames.length > 0) {
    const line = document.createElement("div");
    line.textContent = lineNames;
    container.append(line);
  }
  return container;
}
