import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { resolveTheme } from "./styles/theme";
import "./styles/index.css";

// Dark is RustGit's default look; the first paint is dark and App applies
// the saved preference once settings load.
document.documentElement.dataset.theme = resolveTheme("dark", true);
document.documentElement.dataset.motion = "full";

const container: HTMLElement | null = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
