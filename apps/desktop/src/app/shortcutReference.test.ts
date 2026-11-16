import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GLOBAL_SHORTCUTS } from "./shortcutReference";

const shell: string = readFileSync(resolve(__dirname, "AppShell.tsx"), "utf-8");
const handled: Set<string> = new Set([...shell.matchAll(/shortcut: "([^"]+)"/g)].map((match) => match[1] ?? ""));

describe("shortcut reference", () => {
  it("lists only global shortcuts AppShell handles", () => {
    const missing: string[] = GLOBAL_SHORTCUTS.map((entry) => entry.keys).filter((keys) => !handled.has(keys));
    expect(missing).toEqual([]);
  });

  it("lists every global shortcut AppShell handles", () => {
    const listed: Set<string> = new Set(GLOBAL_SHORTCUTS.map((entry) => entry.keys));
    expect([...handled].filter((keys) => !listed.has(keys))).toEqual([]);
  });
});
