import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAgentTeamConfig } from "../../src/core/config.js";
import { listProviders, getProviderRuntime } from "../../src/providers/index.js";
import { selectProvider } from "../../src/core/router.js";
import { createAgyRuntime } from "../../src/providers/agy/runtime.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function load(providers: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "agent-team-agy-migration-")); roots.push(root);
  await mkdir(join(root, ".agent-team"));
  await writeFile(join(root, ".agent-team/config.json"), JSON.stringify({ providers }));
  return loadAgentTeamConfig(root);
}

it("uses AGY by default with sandboxed JSON output and retains its conversation id", async () => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const runtime = createAgyRuntime({ runCommand: async (command, args) => {
    calls.push({ command, args });
    return { ok: true, exitCode: 0, stderr: "", stdout: JSON.stringify({ status: "SUCCESS", response: "Reviewed", conversation_id: "conversation-1" }) };
  } });
  const result = await runtime.runPrint({ prompt: "Review", cwd: "/tmp" });
  expect(calls).toEqual([{ command: "agy", args: ["--print", "Review", "--output-format", "json", "--sandbox", "--mode", "plan"] }]);
  expect(result).toMatchObject({ ok: true, text: "Reviewed", sessionId: "conversation-1" });
});

it("lists AGY without granting write capabilities from old Gemini proof", async () => {
  const config = await load({});
  expect(config.providers).toHaveProperty("agy.executable", "agy");
  expect(config.providers).toHaveProperty("agy.writeValidated", false);
  const providers = listProviders({ config, cliAvailability: { claude: false, agy: true, codex: false, ollama: false }, env: {} });
  const provider = providers.find(p => p.id === "agy");
  expect(provider).toBeDefined();
  expect(provider?.displayName).toBe("Gemini via AGY");
  expect(provider?.capabilities).toEqual(expect.arrayContaining(["sessionResume", "cancellation"]));
  expect(provider?.capabilities).not.toContain("edits");
  expect(providers.some(p => p.id === "gemini-cli")).toBe(false);
});

it("migrates legacy Gemini settings without transferring executable or write validation", async () => {
  const config = await load({ geminiCli: { enabled: true, executable: "/old/bin/gemini", writeValidated: true, capabilities: { tools: true, edits: true, workspaceIsolation: true } } });
  expect(config.providers).toHaveProperty("agy.executable", "agy");
  expect(config.providers).toHaveProperty("agy.writeValidated", false);
  expect(config.providers).toHaveProperty("agy.capabilities.edits", false);
});

it("preserves explicit AGY settings and lets the canonical key take precedence", async () => {
  const old = await load({ geminiCli: { driver: "agy", executable: "/custom/agy", model: "configured-model", writeValidated: true } });
  expect(old.providers).toHaveProperty("agy.executable", "/custom/agy");
  expect(old.providers).toHaveProperty("agy.writeValidated", true);
  const current = await load({ agy: { enabled: false }, geminiCli: { driver: "agy", enabled: true } });
  expect(current.providers).toHaveProperty("agy.enabled", false);
});

it("routes legacy selectors and runtime lookups to AGY", () => {
  const provider = { id: "agy", displayName: "Gemini via AGY", authMode: "oauth" as const, capabilities: ["structuredOutput" as const], available: true };
  for (const selector of ["agy", "gemini-cli", "family:gemini-cli"]) {
    expect(selectProvider({ roleId: "planner", providers: [provider], requestedProviderId: selector }).id).toBe("agy");
  }
  expect(getProviderRuntime("gemini-cli")?.id).toBe("agy");
});

it("rejects the obsolete executable in canonical AGY configuration", async () => {
  await expect(load({ agy: { executable: "/old/bin/gemini" } })).rejects.toThrow(/AGY|agy/);
});
