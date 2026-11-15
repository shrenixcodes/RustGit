export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const DARK_QUERY: string = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return preference;
}

/**
 * Applies the theme to the document root. For "system" it follows OS changes
 * until the returned cleanup function is called.
 */
export function applyTheme(preference: ThemePreference, root: HTMLElement = document.documentElement): () => void {
  const media: MediaQueryList = window.matchMedia(DARK_QUERY);
  const update = (): void => {
    root.dataset.theme = resolveTheme(preference, media.matches);
  };
  update();

  if (preference !== "system") {
    return () => {};
  }
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
