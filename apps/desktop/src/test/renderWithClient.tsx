import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { createQueryClient } from "../services/queries";

/** Renders a component with a fresh query client (no shared cache between tests). */
export function renderWithClient(element: ReactElement): RenderResult {
  return render(<QueryClientProvider client={createQueryClient()}>{element}</QueryClientProvider>);
}
