import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
// After styles.css so its clear-screen rules keep their original cascade position.
import "./features/game/components/clearScreen.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
