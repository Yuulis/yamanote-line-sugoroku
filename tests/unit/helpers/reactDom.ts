import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface MountedReact {
  container: HTMLDivElement;
  root: Root;
  render: (node: ReactNode) => void;
  cleanup: () => void;
}

export function mountReact(node: ReactNode): MountedReact {
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
