import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface MountedReact {
  container: HTMLDivElement;
  root: Root;
  render: (node: ReactNode) => void;
  cleanup: () => void;
}

export function mountReact(node: ReactNode): MountedReact {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (next: ReactNode) => act(() => root.render(createElement(() => next)));
  act(() => root.render(node));
  return {
    container,
    root,
    render,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export async function flushReact(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

export function dispatchReactEvent(element: Element, event: Event): void {
  act(() => element.dispatchEvent(event));
}
