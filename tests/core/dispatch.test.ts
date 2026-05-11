import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMailboxRecords } from "../../src/core/state/mailbox-store.js";
import { runLogPath } from "../../src/core/state/paths.js";
import { readRunSidecar } from "../../src/core/state/run-store.js";
import { dispatchReadOnlyAgent } from "../../src/core/dispatch.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-dispatch-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const shipText = `Review complete.
<<<VERDICT>>>
status: SHIP
summary: Looks good.
required_changes:
- none
evidence:
- fixture
risks:
- none
<<<END_VERDICT>>>`;

describe("dispatchReadOnlyAgent", () => {
  it("dispatches a read-only role and persists sidecars, mailboxes, and logs", async () => {
    const result = await dispatchReadOnlyAgent(
      {
        role: "code-reviewer",
        task: "Review this diff",
        cwd: workspace
      },
      {
        createRunId: () => "run_test",
        now: () => new Date("2026-05-11T00:00:00.000Z"),
        env: {},
        runClaude: async () => ({
          ok: true,
          sessionId: "session_1",
          text: shipText,
          stdout: JSON.stringify({ session_id: "session_1", result: shipText }),
          stderr: "",
          exitCode: 0
        })
      }
    );

    expect(result).toMatchObject({
      runId: "run_test",
      status: "completed",
      provider: "claude-code-cli",
      role: "code-reviewer"
    });
    expect(result.verdict.status).toBe("SHIP");

    const sidecar = await readRunSidecar(workspace, "run_test");
    expect(sidecar).toMatchObject({
      runId: "run_test",
      status: "completed",
      providerSessionId: "session_1",
      outputSummary: "Looks good."
    });
    expect(sidecar.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sidecar.evidencePaths).toContain(runLogPath(workspace, "run_test"));

    const events = await readMailboxRecords(workspace, "run_test", "events");
    expect(events.map((event) => event.messageType)).toEqual([
      "queued",
      "running",
      "completed"
    ]);

    await expect(readFile(runLogPath(workspace, "run_test"), "utf8")).resolves.toContain(
      shipText
    );
  });

  it("rejects implementation roles before invoking a provider", async () => {
    let called = false;
    const result = await dispatchReadOnlyAgent(
      {
        role: "slice-implementer",
        task: "Edit files",
        cwd: workspace
      },
      {
        createRunId: () => "run_impl",
        runClaude: async () => {
          called = true;
          throw new Error("should not run");
        }
      }
    );

    expect(called).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.verdict.status).toBe("BLOCKED");
    expect(result.verdict.summary).toContain("not supported");
  });

  it("blocks subscription-mode dispatch when API auth override env exists", async () => {
    let called = false;
    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace
      },
      {
        createRunId: () => "run_auth",
        env: { ANTHROPIC_API_KEY: "secret" },
        runClaude: async () => {
          called = true;
          throw new Error("should not run");
        }
      }
    );

    expect(called).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.verdict.status).toBe("BLOCKED");
    expect(result.verdict.summary).toContain("override Claude Code subscription OAuth");
  });

  it("records failed provider runs with a failed sidecar", async () => {
    const result = await dispatchReadOnlyAgent(
      {
        role: "debugger",
        task: "Explain failure",
        cwd: workspace
      },
      {
        createRunId: () => "run_failed",
        now: () => new Date("2026-05-11T00:00:00.000Z"),
        env: {},
        runClaude: async () => ({
          ok: false,
          text: "",
          stdout: "",
          stderr: "bad auth",
          exitCode: 2
        })
      }
    );

    expect(result.status).toBe("failed");
    expect(result.verdict.status).toBe("BLOCKED");
    const sidecar = await readRunSidecar(workspace, "run_failed");
    expect(sidecar.status).toBe("failed");
    await expect(readFile(runLogPath(workspace, "run_failed"), "utf8")).resolves.toContain(
      "bad auth"
    );
  });
});
