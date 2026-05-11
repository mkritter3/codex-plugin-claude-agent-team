import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureClaudeAgentDefinitionArtifacts,
  ensureValidClaudeAgentDefinitionArtifacts,
  validateClaudeAgentDefinitionArtifacts
} from "../../../src/providers/claude-code-cli/agent-definition-store.js";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-team-claude-agent-artifacts-"));
}

describe("Claude agent definition artifact store", () => {
  it("writes generated definitions and manifest under provider-owned state", async () => {
    const root = await workspace();

    const result = await ensureClaudeAgentDefinitionArtifacts({ workspaceRoot: root });

    expect(result.manifest).toMatchObject({
      providerId: "claude-code-cli",
      definitionCount: 7,
      roleIds: [
        "architect",
        "planner",
        "code-reviewer",
        "debugger",
        "test-designer",
        "slice-implementer",
        "ux-product-critic"
      ],
      agentsPath: ".agent-team/providers/claude/agents.json",
      manifestPath: ".agent-team/providers/claude/manifest.json"
    });
    expect(result.manifest.definitionsHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(readFile(result.agentsPath, "utf8")).resolves.toContain(
      "\"code-reviewer\""
    );
    await expect(readFile(result.manifestPath, "utf8")).resolves.toContain(
      "\"definitionsHash\""
    );
  });

  it("produces a stable definitions hash across repeated ensures", async () => {
    const root = await workspace();

    const first = await ensureClaudeAgentDefinitionArtifacts({ workspaceRoot: root });
    const second = await ensureClaudeAgentDefinitionArtifacts({ workspaceRoot: root });

    expect(second.manifest.definitionsHash).toBe(first.manifest.definitionsHash);
  });

  it("fails validation when persisted definitions drift from the manifest", async () => {
    const root = await workspace();
    const written = await ensureClaudeAgentDefinitionArtifacts({ workspaceRoot: root });
    const definitions = JSON.parse(await readFile(written.agentsPath, "utf8"));
    definitions.planner.description = "Drifted planner description.";
    await mkdir(join(root, ".agent-team", "providers", "claude"), { recursive: true });
    await writeFile(written.agentsPath, `${JSON.stringify(definitions, null, 2)}\n`, "utf8");

    await expect(
      validateClaudeAgentDefinitionArtifacts({ workspaceRoot: root })
    ).rejects.toThrow("Claude agent definition artifact hash mismatch.");
  });

  it("creates missing artifacts then validates existing artifacts without rewriting", async () => {
    const root = await workspace();

    const created = await ensureValidClaudeAgentDefinitionArtifacts({
      workspaceRoot: root
    });
    const createdAgentsStat = await stat(created.agentsPath);
    const createdManifestStat = await stat(created.manifestPath);
    const validated = await ensureValidClaudeAgentDefinitionArtifacts({
      workspaceRoot: root
    });

    expect(created.action).toBe("created");
    expect(validated.action).toBe("validated");
    expect(validated.manifest.definitionsHash).toBe(created.manifest.definitionsHash);
    await expect(stat(validated.agentsPath)).resolves.toMatchObject({
      mtimeMs: createdAgentsStat.mtimeMs
    });
    await expect(stat(validated.manifestPath)).resolves.toMatchObject({
      mtimeMs: createdManifestStat.mtimeMs
    });
  });

  it("does not repair drift through the validate-or-create helper", async () => {
    const root = await workspace();
    const written = await ensureValidClaudeAgentDefinitionArtifacts({ workspaceRoot: root });
    const definitions = JSON.parse(await readFile(written.agentsPath, "utf8"));
    definitions.planner.description = "Drifted planner description.";
    await writeFile(written.agentsPath, `${JSON.stringify(definitions, null, 2)}\n`, "utf8");

    await expect(
      ensureValidClaudeAgentDefinitionArtifacts({ workspaceRoot: root })
    ).rejects.toThrow("Claude agent definition artifact hash mismatch.");
  });
});
