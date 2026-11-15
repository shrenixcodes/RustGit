import { useEffect, useState } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { AppShell } from "./AppShell";
import { createQueryClient, useSettings } from "../services/queries";
import { applyTheme } from "../styles/theme";
import type { ThemePreference } from "../services/types";
import { applyPreferences, usePreferences, type Density, type MotionPreference } from "../stores/preferences";

export function App() {
  const [queryClient] = useState<QueryClient>(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeController />
      <PreferencesController />
      <AppShell />
    </QueryClientProvider>
  );
}

/** Applies the saved theme preference (dark, the default look, until settings load or if they fail). */
function ThemeController() {
  const settings = useSettings();
  const theme: ThemePreference = settings.data?.theme ?? "dark";
  useEffect(() => applyTheme(theme), [theme]);
  return null;
}

/** Mirrors density and motion preferences onto the document root. */
function PreferencesController() {
  const density: Density = usePreferences((state) => state.density);
  const motion: MotionPreference = usePreferences((state) => state.motion);
  useEffect(() => applyPreferences({ density, motion }, document.documentElement), [density, motion]);
  return null;
}
