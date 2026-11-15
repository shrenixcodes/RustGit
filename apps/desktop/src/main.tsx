import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { resolveTheme } from "./styles/theme";
import "./styles/index.css";

// Initial paint follows the OS; App applies the saved preference once loaded.
document.documentElement.dataset.theme = resolveTheme(
  "system",
  window.matchMedia("(prefers-color-scheme: dark)").matches,
);

const container: HTMLElement | null = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
