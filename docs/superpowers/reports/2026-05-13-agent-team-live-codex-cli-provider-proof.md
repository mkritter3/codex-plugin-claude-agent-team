# Live Codex CLI Provider Proof

Date: 2026-05-13

This report records opt-in live-provider evidence for the `codex-cli` adapter only. It does not make a provider ranking, comparative capability, long-context, or broad autonomous-coding-readiness claim.

## Scope

- Provider selector: `codex-cli`
- Selected provider id: `codex-cli`
- Auth mode reported by MCP provider list: `subscription-oauth`
- Codex CLI version observed by doctor: `codex-cli 0.130.0`
- Model configured for proof workspace: `gpt-5.5`
- Execution policy: read-only provider dispatch
- MCP entrypoint: packaged `dist/index.js`

## Result

The packaged MCP stdio server successfully:

- loaded a disposable workspace config with `providers.codexCli.enabled: true`
- passed `agent_team_doctor` after unrelated Claude API env was removed from the smoke process
- selected `codex-cli` through `agent_team_dispatch`
- completed the provider run through local Codex CLI subscription login
- returned dashboard and summary evidence for the completed run

Proof run id:

- `run_20260513193437171_096a5944a565`

Sanitized smoke summary:

```json
{
  "status": "completed",
  "liveProviderUse": true,
  "providerSelectors": ["codex-cli"],
  "proofs": [
    {
      "status": "completed",
      "selectedProviderId": "codex-cli",
      "authMode": "subscription-oauth",
      "runStatus": "completed"
    }
  ],
  "dashboard": {
    "status": "ok",
    "counts": {
      "total": 1,
      "terminal": 1,
      "failed": 0
    }
  },
  "summary": {
    "status": "ok"
  }
}
```

## Live Issues Found And Fixed

The first live pass reached `codex-cli` but failed because the adapter still passed a stale `codex exec --ask-for-approval never` flag. Codex CLI `0.130.0` no longer accepts that flag for `codex exec`.

After removing the stale flag, the second live pass reached `codex-cli` but timed out because the print runner used `execFile`, which left stdin in a shape that caused Codex CLI to wait for additional stdin. The adapter now uses `spawn` for print dispatch with stdin ignored, matching the background-session execution shape.

## Boundaries

- This proof validates read-only provider routing through the packaged MCP server.
- This proof validates local Codex CLI subscription-backed execution for the configured model.
- This proof does not validate isolated write mode for Codex CLI.
- Codex CLI write mode remains gated on `writeValidated: true`, explicit write capabilities, and allowed isolated worktree roots.
- The adapter strips `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, and `OPENAI_PROJECT` before launching Codex CLI so local Codex CLI login remains the auth boundary.
