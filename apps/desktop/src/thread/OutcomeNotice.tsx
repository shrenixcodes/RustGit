import type { BranchOutcome } from "../services/queries";

/** What a branch or integration operation actually did, from the backend's answer. */
export function describeOutcome(outcome: BranchOutcome): { tone: "ok" | "attention"; text: string } {
  if (outcome.kind !== "integration") return { tone: "ok", text: "Done." };
  const { result } = outcome;
  switch (result.outcome) {
    case "up_to_date":
      return { tone: "ok", text: "Already up to date: nothing to integrate." };
    case "fast_forward":
      return { tone: "ok", text: "Fast-forwarded: the branch now points at the newer commit." };
    case "completed":
      return { tone: "ok", text: "Completed." };
    case "conflicts":
      return {
        tone: "attention",
        text: `Stopped with conflicts in ${result.conflicted.length} file${result.conflicted.length === 1 ? "" : "s"}: ${result.conflicted.join(", ")}. Resolve them at the loose end, then continue or abort.`,
      };
  }
}

export function OutcomeNotice({ outcome }: { outcome: BranchOutcome }) {
  const { tone, text } = describeOutcome(outcome);
  return (
    <p role="status" className={`text-sm ${tone === "ok" ? "text-success" : "text-warning"}`}>
      {text}
    </p>
  );
}
