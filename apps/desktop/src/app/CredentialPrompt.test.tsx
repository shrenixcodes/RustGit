import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const listeners: Array<(event: { payload: unknown }) => void> = [];
const invokeMock = vi.fn(async () => null);

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...(args as [])) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, cb: (event: { payload: unknown }) => void) => {
    listeners.push(cb);
    return () => {};
  }),
}));

const { CredentialPrompt } = await import("./CredentialPrompt");

afterEach(() => {
  cleanup();
  listeners.length = 0;
  invokeMock.mockClear();
});

describe("CredentialPrompt", () => {
  it("toggles secret visibility and submits or cancels cleanly", async () => {
    render(<CredentialPrompt />);
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    act(() => {
      listeners[0]!({
        payload: { requestId: "req-1", prompt: "Password for 'https://github.com': ", secret: true },
      });
    });

    const input = await screen.findByLabelText(/Password for 'https:\/\/github\.com'/) as HTMLInputElement;
    expect(input.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show secret" }));
    expect(input.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Hide secret" }));
    expect(input.type).toBe("password");

    fireEvent.change(input, { target: { value: "topsecret" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(invokeMock).toHaveBeenCalledWith("respond_credential", { requestId: "req-1", answer: "topsecret" });
  });
});
