import { readRunSidecar } from "../state/run-store.js";
import { isSafeRunId } from "../state/paths.js";
import type { AuthorityEvidence } from "./contract.js";

export async function verifyProviderVotes(workspaceRoot: string, evidence: AuthorityEvidence | undefined): Promise<void> {
  for (const vote of evidence?.votes ?? []) {
    if (vote.execution.kind !== "provider-run") continue;
    if (!isSafeRunId(vote.execution.id)) throw new Error("Provider authority evidence requires a valid Agent Team run id");
    const run = await readRunSidecar(workspaceRoot, vote.execution.id);
    const target = vote.execution.target;
    if (target.kind !== "provider" || run.provider !== target.provider || run.model !== target.model) throw new Error("Provider authority evidence does not match the recorded provider/model");
    if (vote.status === "approve" && run.status !== "completed") throw new Error("An incomplete or failed provider run cannot approve an artifact");
  }
}
