import { useEffect, useState } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { AppShell } from "./AppShell";
import { createQueryClient, useSettings } from "../services/queries";
import { applyTheme } from "../styles/theme";
import type { ThemePreference } from "../services/types";

export function App() {
  const [queryClient] = useState<QueryClient>(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeController />
      <AppShell />
    </QueryClientProvider>
  );
}

/** Applies the saved theme preference (System until settings load). */
function ThemeController() {
  const settings = useSettings();
  const theme: ThemePreference = settings.data?.theme ?? "system";
  useEffect(() => applyTheme(theme), [theme]);
  return null;
}
