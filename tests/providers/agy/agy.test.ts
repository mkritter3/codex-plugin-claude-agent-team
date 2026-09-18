import { afterEach, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_AGENT_TEAM_CONFIG, loadAgentTeamConfig } from "../../../src/core/config.js";
import { createAgyRuntime } from "../../../src/providers/agy/runtime.js";
import { agyProviderDescriptor } from "../../../src/providers/agy/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";

const config = { ...DEFAULT_AGENT_TEAM_CONFIG, providers: { ...DEFAULT_AGENT_TEAM_CONFIG.providers,
  agy: { ...DEFAULT_AGENT_TEAM_CONFIG.providers.agy, driver: "agy", executable: "agy", model: "gemini-3.8-flash-high", writeValidated: true, capabilities: { ...DEFAULT_AGENT_TEAM_CONFIG.providers.agy.capabilities, tools: true, edits: true, workspaceIsolation: true } }
} } as AgentTeamConfig;
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("uses AGY's plan/sandbox flags and rejects an unsuccessful JSON result", async () => {
  const calls: string[][] = [];
  let status = "SUCCESS";
  const runtime = createAgyRuntime({ config, runCommand: async (_, args) => {
    calls.push([...args]); return { ok: true, exitCode: 0, stderr: "", stdout: JSON.stringify({ status, response: "Review findings", conversation_id: "conversation1" }) };
  } });
  const input = { prompt: "Review this plan", cwd: "/tmp", roleId: "planner" as const, executionPolicy: "read-only" as const };
  expect((await runtime.runPrint(input)).text).toBe("Review findings");
  expect(calls[0]).toEqual(["--print", "Review this plan", "--output-format", "json", "--model", "gemini-3.8-flash-high", "--sandbox", "--mode", "plan"]);
  status = "ERROR";
  expect((await runtime.runPrint(input)).ok).toBe(false);
});

it("retains AGY's returned conversation id and resumes it with accept-edits inside a worktree", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "team-agy-")); roots.push(workspace);
  class Process extends EventEmitter {
    stdout = new PassThrough(); stderr = new PassThrough(); kill() { return true; }
  }
  const children: Process[] = []; const calls: string[][] = [];
  const runtime = createAgyRuntime({ config, spawn: (_, args) => { calls.push([...args]); const child = new Process(); children.push(child); return child; } });
  const input = { prompt: "Implement", cwd: workspace, workspaceRoot: workspace, runId: "run_agy", roleId: "slice-implementer" as const, executionPolicy: "isolated-edit" as const };
  const first = runtime.startSession(input);
  children[0]!.stdout.end(JSON.stringify({ status: "SUCCESS", response: "Implemented", conversation_id: "real-conversation" }) + "\n");
  children[0]!.emit("close", 0, null);
  expect(await first.done).toBe("completed");
  expect(first.snapshot?.().providerSessionId).toBe("real-conversation");
  expect(first.snapshot?.().text).toBe("Implemented");
  expect(calls[0]).toContain("accept-edits");
  expect(calls[0]).not.toContain("--conversation");
  const second = runtime.startSession({ ...input, runId: "run_agy2", sessionId: "real-conversation" });
  expect(calls[1]).toContain("--conversation");
  expect(calls[1]).toContain("real-conversation");
  children[1]!.stdout.end('{"status":"ERROR","response":"failed"}\n'); children[1]!.emit("close", 0, null);
  expect(await second.done).toBe("failed");
});

it("loads AGY configuration without implicitly granting write validation", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "team-agy-config-")); roots.push(workspace);
  await mkdir(join(workspace, ".agent-team"));
  await writeFile(join(workspace, ".agent-team/config.json"), JSON.stringify({ providers: { agy: { driver: "agy", model: "gemini-3.8-flash-high" } } }));
  const loaded = await loadAgentTeamConfig(workspace);
  expect(loaded.providers.agy).toMatchObject({ driver: "agy", executable: "agy", writeValidated: false });
  expect(agyProviderDescriptor(loaded, { executableAvailable: true })).toMatchObject({ available: true });
  expect(agyProviderDescriptor(loaded).capabilities).not.toContain("edits");
  expect(agyProviderDescriptor(loaded).capabilities).toEqual(expect.arrayContaining(["sessionResume", "cancellation"]));
});
