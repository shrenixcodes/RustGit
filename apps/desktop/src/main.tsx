import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyPreferences, usePreferences } from "./stores/preferences";
import { resolveTheme } from "./styles/theme";
import "./styles/index.css";

// Dark is RustGit's default look; the first paint is dark and App applies
// the saved theme once settings load. Motion and personality are stored
// locally, so they apply before the first paint (honouring reduced motion).
document.documentElement.dataset.theme = resolveTheme("dark", true);
applyPreferences(usePreferences.getState(), document.documentElement);

const container: HTMLElement | null = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
