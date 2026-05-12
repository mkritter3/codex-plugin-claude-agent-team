import { describe, expect, it } from "vitest";
import { buildAgentTeamDashboard } from "../../src/core/team-dashboard.js";
import type { AgentTeamSummaryResult } from "../../src/core/types.js";

const generatedAt = "2026-05-12T12:00:00.000Z";

function mailboxEvidence(runId: string) {
  return {
    inbox: { path: `/repo/.agent-team/mailboxes/${runId}/inbox.jsonl`, count: 0 },
    outbox: {
      path: `/repo/.agent-team/mailboxes/${runId}/outbox.jsonl`,
      count: 1,
      lastSequence: 7
    },
    control: { path: `/repo/.agent-team/mailboxes/${runId}/control.jsonl`, count: 0 },
    events: {
      path: `/repo/.agent-team/mailboxes/${runId}/events.jsonl`,
      count: 2,
      lastSequence: 9
    }
  };
}

describe("buildAgentTeamDashboard", () => {
  it("builds ordered counts, rows, evidence pointers, and a compact report", () => {
    const summary: AgentTeamSummaryResult = {
      status: "partial_failure",
      groups: {
        running: ["run_active"],
        awaitingInput: ["run_waiting"],
        windingDown: [],
        terminal: ["run_failed_agent", "run_done"],
        failed: ["run_failed_agent"],
        detached: ["run_active"],
        cleanupBlocked: ["run_done"],
        retainedWorktree: ["run_active", "run_done"]
      },
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_active",
          cwd: "/repo",
          correlationId: "planner",
          run: {
            runId: "run_active",
            role: "planner",
            provider: "claude-code-cli",
            status: "running",
            operationalState: "running",
            createdAt: "2026-05-12T10:00:00.000Z",
            updatedAt: "2026-05-12T10:05:00.000Z",
            detached: true,
            retainedWorktree: true,
            cleanupBlocked: false,
            executionCwd: "/repo/.worktrees/run_active",
            workspaceCleanup: "retained",
            currentActivity: { type: "tool_start", summary: "Running tests", timestamp: 3 },
            recentActivities: [{ type: "text", summary: "Scanning files", timestamp: 2 }]
          },
          evidence: {
            sidecarPath: "/repo/.agent-team/runs/run_active.json",
            mailboxes: mailboxEvidence("run_active"),
            logPath: "/repo/.agent-team/logs/run_active.log",
            transcriptPath: "/repo/.agent-team/logs/run_active.transcript.jsonl",
            workspaceDiffPath: "/repo/.agent-team/logs/run_active.diff.patch",
            evidencePaths: ["/repo/.agent-team/logs/run_active.diff.patch"],
            changedFiles: ["src/core/team-dashboard.ts"]
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_waiting",
          cwd: "/repo",
          run: {
            runId: "run_waiting",
            role: "code-reviewer",
            provider: "claude-code-cli",
            status: "awaiting-input",
            operationalState: "awaitingInput",
            createdAt: "2026-05-12T10:00:00.000Z",
            updatedAt: "2026-05-12T10:06:00.000Z",
            detached: false,
            retainedWorktree: false,
            cleanupBlocked: false,
            awaitingInputSince: "2026-05-12T10:06:00.000Z",
            pendingOutboxRequest: {
              id: "question_1",
              sequence: 1,
              messageType: "clarification",
              correlationId: "question",
              createdAt: "2026-05-12T10:06:00.000Z",
              payload: { question: "Need a decision" }
            },
            outputSummary: "Need a decision"
          },
          evidence: {
            sidecarPath: "/repo/.agent-team/runs/run_waiting.json",
            mailboxes: mailboxEvidence("run_waiting")
          }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_failed_agent",
          cwd: "/repo",
          run: {
            runId: "run_failed_agent",
            role: "debugger",
            provider: "claude-code-cli",
            status: "failed",
            operationalState: "terminal",
            createdAt: "2026-05-12T10:00:00.000Z",
            updatedAt: "2026-05-12T10:07:00.000Z",
            detached: false,
            retainedWorktree: false,
            cleanupBlocked: false,
            outputSummary: "Run failed after tests"
          },
          evidence: {
            sidecarPath: "/repo/.agent-team/runs/run_failed_agent.json",
            mailboxes: mailboxEvidence("run_failed_agent")
          }
        },
        {
          status: "failed",
          index: 3,
          runId: "run_missing",
          cwd: "/repo",
          error: "missing sidecar"
        },
        {
          status: "state_corrupt",
          index: 4,
          runId: "run_corrupt",
          cwd: "/repo",
          recovery: {
            status: "state_corrupt",
            operation: "agent_team_summary",
            recovery: "archived"
          }
        }
      ]
    };

    const dashboard = buildAgentTeamDashboard({
      source: {
        kind: "team",
        teamId: "team_alpha",
        evidencePath: "/repo/.agent-team/teams/team_alpha.json"
      },
      summary,
      generatedAt
    });

    expect(dashboard).toMatchObject({
      status: "partial_failure",
      source: { kind: "team", teamId: "team_alpha" },
      generatedAt,
      counts: {
        total: 5,
        running: 1,
        awaitingInput: 1,
        windingDown: 0,
        terminal: 2,
        failed: 2,
        detached: 1,
        cleanupBlocked: 1,
        retainedWorktree: 2,
        recovered: 1
      },
      rows: [
        {
          index: 0,
          runId: "run_active",
          status: "ok",
          role: "planner",
          provider: "claude-code-cli",
          runStatus: "running",
          latestActivity: "Running tests",
          retainedWorktree: true,
          cleanupStatus: "retained",
          workspaceDiffPath: "/repo/.agent-team/logs/run_active.diff.patch",
          changedFiles: ["src/core/team-dashboard.ts"]
        },
        {
          index: 1,
          runId: "run_waiting",
          status: "ok",
          runStatus: "awaiting-input",
          latestActivity: "Need a decision",
          pendingQuestion: true,
          awaitingInputSince: "2026-05-12T10:06:00.000Z",
          cleanupStatus: "not_applicable"
        },
        {
          index: 2,
          runId: "run_failed_agent",
          status: "ok",
          role: "debugger",
          runStatus: "failed",
          latestActivity: "Run failed after tests"
        },
        {
          index: 3,
          runId: "run_missing",
          status: "failed",
          error: "missing sidecar"
        },
        {
          index: 4,
          runId: "run_corrupt",
          status: "state_corrupt",
          recovery: {
            status: "state_corrupt",
            operation: "agent_team_summary",
            recovery: "archived"
          }
        }
      ]
    });
    expect(dashboard.rows[0]?.evidencePaths).toEqual([
      "/repo/.agent-team/runs/run_active.json",
      "/repo/.agent-team/logs/run_active.log",
      "/repo/.agent-team/logs/run_active.transcript.jsonl",
      "/repo/.agent-team/logs/run_active.diff.patch",
      "/repo/.agent-team/logs/run_active.diff.patch"
    ]);
    expect(dashboard.rows[0]?.mailboxPaths).toEqual([
      "/repo/.agent-team/mailboxes/run_active/inbox.jsonl",
      "/repo/.agent-team/mailboxes/run_active/outbox.jsonl",
      "/repo/.agent-team/mailboxes/run_active/control.jsonl",
      "/repo/.agent-team/mailboxes/run_active/events.jsonl"
    ]);
    expect(JSON.stringify(dashboard)).not.toContain("promptHash");
    expect(JSON.stringify(dashboard)).not.toContain("providerSessionId");
    expect(JSON.stringify(dashboard)).not.toContain("payload");
    expect(dashboard.report).toContain(
      "Team team_alpha: 5 runs, 1 running, 1 awaiting input, 2 retained worktrees, 1 cleanup blocked, 1 recovered."
    );
    expect(dashboard.report).toContain(
      "[1] run_waiting code-reviewer awaiting-input question=true updated 2026-05-12T10:06:00.000Z"
    );
    expect(dashboard.report).not.toContain("prompt");
    expect(dashboard.report).not.toContain("session");
  });
});
