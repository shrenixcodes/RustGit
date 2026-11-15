import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";

// Read the real stylesheet; Vitest's CSS handling would strip a `?raw` import.
const css: string = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf8");

/** Extracts `--rg-*: #hex` declarations from the block that starts with `selector`. */
function tokensFor(selector: string): Record<string, string> {
  const start: number = css.indexOf(selector);
  if (start < 0) {
    throw new Error(`selector ${selector} not found`);
  }
  const body: string = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/--rg-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[match[1] as string] = match[2] as string;
  }
  return tokens;
}

const SURFACES = ["bg", "canvas", "sidebar", "surface", "elevated"] as const;
const TEXT = [
  "text",
  "text-secondary",
  "text-muted",
  "accent",
  "accent-strong",
  "clay-text",
  "indigo-text",
  "lavender",
  "amber",
  "yellow",
  "success",
  "warning",
  "danger",
  "info",
] as const;
const GRAPHICAL = [
  "border-control",
  "moss",
  "clay",
  "indigo",
  "violet",
  "lane-0",
  "lane-1",
  "lane-2",
  "lane-3",
  "lane-4",
  "lane-5",
] as const;

const dark: Record<string, string> = tokensFor(':root[data-theme="dark"]');
const THEMES: Record<string, Record<string, string>> = {
  dark,
  // The deep workspace overrides surfaces on top of the dark theme.
  "dark (deep workspace)": { ...dark, ...tokensFor(':root[data-theme="dark"][data-workspace="deep"]') },
  light: tokensFor(':root[data-theme="light"]'),
};

function get(theme: Record<string, string>, name: string): string {
  const value: string | undefined = theme[name];
  if (value === undefined) {
    throw new Error(`token --rg-${name} is missing`);
  }
  return value;
}

describe.each(Object.entries(THEMES))("%s theme", (_name, theme) => {
  it.each(TEXT)("text token %s reaches 4.5:1 on every surface", (token) => {
    for (const surface of SURFACES) {
      expect(contrastRatio(get(theme, token), get(theme, surface)), `${token} on ${surface}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it.each(GRAPHICAL)("graphical token %s reaches 3:1 on every surface", (token) => {
    for (const surface of SURFACES) {
      expect(contrastRatio(get(theme, token), get(theme, surface)), `${token} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("primary button text reaches 4.5:1 on the accent", () => {
    expect(contrastRatio(get(theme, "accent-contrast"), get(theme, "accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the text hierarchy ordered", () => {
    const surface: string = get(theme, "surface");
    const primary: number = contrastRatio(get(theme, "text"), surface);
    const secondary: number = contrastRatio(get(theme, "text-secondary"), surface);
    const muted: number = contrastRatio(get(theme, "text-muted"), surface);
    expect(primary).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(muted);
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
  });
});
