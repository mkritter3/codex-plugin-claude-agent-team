#!/usr/bin/env node
if (process.env.AGENT_TEAM_LIVE_WORKFLOW_VALIDATE !== "1") {
  console.error("Set AGENT_TEAM_LIVE_WORKFLOW_VALIDATE=1 to run live provider workflow validation.");
  process.exit(2);
}

const providers = (process.env.AGENT_TEAM_LIVE_WORKFLOW_PROVIDERS ?? "")
  .split(",")
  .map((provider) => provider.trim())
  .filter(Boolean);

if (providers.length === 0) {
  console.error(
    "Set AGENT_TEAM_LIVE_WORKFLOW_PROVIDERS to a comma-separated provider list such as claude-code-cli,codex-cli,gemini-cli,ollama-claude-code:glm-5.2."
  );
  process.exit(2);
}

const report = {
  generatedAt: new Date().toISOString(),
  claimBoundary: "provider_transport_capability_only",
  liveProviderCalls: "operator_opt_in_required",
  providers,
  checks: providers.map((provider) => ({
    provider,
    status: "not_run_by_fixture_script",
    requiredManualCommand: `AGENT_TEAM_LIVE_WORKFLOW_VALIDATE=1 AGENT_TEAM_LIVE_WORKFLOW_PROVIDERS=${provider} npm run validate:workflow-live`
  }))
};

console.log(JSON.stringify(report, null, 2));
