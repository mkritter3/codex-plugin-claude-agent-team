import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readText = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("packaging and install docs", () => {
  it("keeps README sufficient for local installation and operation", async () => {
    const readme = await readText("../../README.md");

    for (const text of [
      "Prerequisites",
      "Node.js 22",
      "Claude Code CLI subscription OAuth",
      "npm ci",
      "npm run build",
      "npm run install:check",
      "npm run smoke:workflow-orchestrator",
      "npm run validate:workflow-fixtures",
      "npm run validate:workflow-live",
      "npm run scan:workflow-validation",
      "npm run smoke:package",
      "npm run smoke:claude-live",
      "npm run smoke:claude-live-matrix",
      "npm run smoke:providers-live",
      "npm run smoke:gemini-write",
      "npm run smoke:codex-write",
      "Codex CLI",
      "codex-cli",
      "subscription-oauth",
      "docs/superpowers/reports/2026-05-13-agent-team-live-codex-cli-provider-proof.md",
      "docs/superpowers/reports/2026-05-13-agent-team-live-codex-cli-write-proof.md",
      "agent-team-mcp",
      "\"./dist/index.js\"",
      ".agent-team/config.json",
      "schemaVersion",
      "State Layout Version",
      ".agent-team/audit/events.jsonl",
      "agent_team_doctor",
      "agent_team_start_parallel",
      "agent_team_create_team",
      "agent_team_get_team",
      "agent_team_dashboard",
      "agent_team_summary",
      "agent_team_cleanup",
      "agent_team_create_workflow",
      "agent_team_plan_consensus",
      "agent_team_start_slices",
      "agent_team_unblock_slice",
      "agent_team_review_slice",
      "agent_team_integration_queue",
      "agent_team_record_integration",
      "agent_team_workflow_report",
      "agent_team_workflow_next",
      "agent_team_record_user_decision",
      "npm run ci",
      "Troubleshooting",
      "docs/runbooks/claude-team-session.md",
      "docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md",
      "docs/superpowers/reports/2026-05-13-agent-team-workflow-validation-methodology.md",
      "docs/superpowers/reports/2026-05-13-agent-team-live-gemini-write-proof.md"
    ]) {
      expect(readme).toContain(text);
    }
    expect(readme).toContain("opt-in live smoke");
    expect(readme).toContain("not part of CI");
    expect(readme).toContain("--confirm-live-provider-use");
    expect(readme).toContain("policy.liveSmokeEnabled");
    expect(readme).toContain("sanitized report");
    expect(readme).toContain("capability matrix");
    expect(readme).toContain("isolated worktree");
    expect(readme).toContain("mailbox");
    expect(readme).toContain("wind-down");
    expect(readme).toContain("cancel");
    expect(readme).toContain("cleanup");
    expect(readme).toContain("no provider ranking");
    expect(readme).toContain("--provider family:gemini");
    expect(readme).toContain("--provider gemini-cli");
    expect(readme).toContain("GEMINI_CLI_TRUST_WORKSPACE=true");
    expect(readme).toContain("gemini-3-flash-preview");
    expect(readme).toContain("frontend-engineer");
    expect(readme).toContain("--approval-mode auto_edit");
    expect(readme).toContain("explicit read-only provider routing");
    expect(readme).toContain("no provider comparison, ranking, score, or long-context claim");
    expect(readme).toContain("absolute MCP config");
    expect(readme).toContain("does not call providers");
    expect(readme).toContain("read-only dashboard");
	    expect(readme).toContain("policy");
	    expect(readme).toContain("allowedProviderSelectors");
	    expect(readme).toContain("auditEnabled");
	    expect(readme).toContain("providers.ollamaClaudeCode");
	    expect(readme).toContain("OLLAMA_API_KEY");
	    expect(readme).toContain("ollama-claude-code:kimi-k2.6");
	    expect(readme).toContain("ANTHROPIC_BASE_URL");
	    expect(readme).toContain("scoped provider env");
	    expect(readme).toContain("writeValidated");
	    expect(readme).toContain("Kimi K2.6");
	    expect(readme).toContain("GLM 5.1");
	    expect(readme).toContain("DeepSeek");
    expect(readme).toContain("local Codex CLI login remains the auth boundary");
    expect(readme).toContain("OPENAI_API_KEY");
    expect(readme).toContain("OPENAI_BASE_URL");
    expect(readme).toContain("OPENAI_ORG_ID");
    expect(readme).toContain("OPENAI_PROJECT");
    expect(readme).toContain("independently runs `npm test` in the execution worktree");
    expect(readme).toContain("model-quality claim");
    expect(readme).toContain("Workflow Orchestrator");
    expect(readme).toContain("Guided Agent Team Workflow");
    expect(readme).toContain("Hook Hierarchy");
    expect(readme).toContain("recorded_for_resume");
    expect(readme).toContain("follow_up_run");
    expect(readme).toContain("completionStatus");
    expect(readme).toContain("Codex-owned manual integration");
    expect(readme).toContain("final gate verification");
    expect(readme).toContain("cleanup only after integration evidence is saved");
    expect(readme).toContain("workflow_mechanics_only");
    expect(readme).toContain("provider_transport_capability_only");
    expect(readme).toContain("AGENT_TEAM_LIVE_WORKFLOW_VALIDATE=1");
	  });

  it("documents versioning and changelog policy", async () => {
    const changelog = await readText("../../CHANGELOG.md");
    const releaseNotes = await readText("../../docs/releases/0.1.0.md");

    expect(changelog).toContain("# Changelog");
    expect(changelog).toContain("0.1.0");
    expect(changelog).toContain("Versioning Policy");
    expect(changelog).toContain("config schema and state layout compatibility checks");
    expect(changelog).toContain("opt-in live Claude team smoke harness");
	    expect(changelog).toContain("opt-in Claude live capability matrix");
	    expect(changelog).toContain("read-only provider proof smoke harness");
	    expect(changelog).toContain("Ollama Claude Code profiles");
	    expect(changelog).toContain("single `OLLAMA_API_KEY`");
	    expect(changelog).toContain("scoped Anthropic-compatible environment");
	    expect(changelog).toContain("install handoff preflight");
    expect(changelog).toContain("policy and audit controls");
    expect(changelog).toContain("MCP tool surface changes");
    expect(changelog).toContain("npm run smoke:package");
    expect(changelog).toContain("npm run ci");

    for (const text of [
      "0.1.0 Release Notes",
      "MCP Tool Surface",
      "Provider Compatibility",
      "Config Schema Version",
      "State Layout Version",
      "Migration Notes",
      "schemaVersion",
      "state-layout.json",
      "npm run ci",
      "npm run smoke:package"
    ]) {
      expect(releaseNotes).toContain(text);
    }
  });

  it("ships the declared MIT license text", async () => {
    const license = await readText("../../LICENSE");

    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright");
    expect(license).toContain("Permission is hereby granted");
  });

  it("keeps docs free of private implementation leakage and unsafe onboarding paths", async () => {
    const combined = `${await readText("../../README.md")}\n${await readText("../../CHANGELOG.md")}`;
    const forbiddenAuthPattern = new RegExp(
      [
        "ANTHROPIC" + "_API_KEY=.*",
        "ANTHROPIC" + "_AUTH_TOKEN=.*",
        "api[- ]key " + "fallback"
      ].join("|"),
      "i"
    );
    const forbiddenPrivatePattern = new RegExp(
      [
        "internal " + "prompt",
        "hidden " + "instruction",
        "generated " + "agent definition",
        "bypass" + "Permissions",
        "process " + "id"
      ].join("|"),
      "i"
    );
    const forbiddenClaimPattern = new RegExp(
      ["bench" + "mark", "quality " + "score", "model-quality " + "comparison"].join("|"),
      "i"
    );

    expect(combined).not.toMatch(forbiddenAuthPattern);
    expect(combined).not.toMatch(forbiddenPrivatePattern);
    expect(combined).not.toMatch(forbiddenClaimPattern);
  });
});
