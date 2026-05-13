# Agent Team Live Ollama Write Proof

Date: 2026-05-13

## Decision

Live Ollama Claude Code write-mode proof passed for the selected profiles.

This report records opt-in live-provider evidence only. It does not make a benchmark, latency, comparative provider, comparative model, long-context, or broad autonomous-coding-readiness claim.

## Proof Boundary

- Provider path: `ollama-claude-code:<profile-id>` through Claude Code.
- Auth posture: explicit Ollama provider config with one plugin-level Ollama Cloud key in the operator environment.
- Runtime boundary: packaged MCP stdio entrypoint after `npm run build`.
- Workspaces: disposable git fixtures with `policy.liveSmokeEnabled: true`.
- Write mode: enabled only inside each disposable fixture with `writeValidated: true`.
- Isolation: each proof used a retained git worktree and then removed it through `agent_team_cleanup`.
- Source safety: each proof verified the source checkout did not contain `OLLAMA_WRITE_PROOF.txt`.
- Public reports: sanitized provider ids, run ids, statuses, sidecar/log paths, changed-file names, dashboard counts, and summary groups only.

## Commands

```bash
npm run build
npm run smoke:ollama-write -- --dry-run --provider ollama-claude-code:kimi-k2.6 --provider ollama-claude-code:glm-5.1 --provider ollama-claude-code:deepseek-v4-flash
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:kimi-k2.6 --provider ollama-claude-code:glm-5.1 --provider ollama-claude-code:deepseek-v4-flash --timeout-ms 300000 --max-wait-ms 360000
```

The first confirmed run failed closed in `agent_team_doctor` because Anthropic token-shaped environment variables were present and API fallback is disabled. The successful run stripped those Anthropic token-shaped variables while preserving the Ollama Cloud key.

## Results

| Provider selector | Result | Run id | Evidence |
| --- | --- | --- | --- |
| `ollama-claude-code:kimi-k2.6` | Passed | `run_20260513140110838_28860808f492` | Completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, source unmodified, cleanup removed the retained worktree. |
| `ollama-claude-code:glm-5.1` | Passed | `run_20260513140212429_5478e31e940e` | Completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, source unmodified, cleanup removed the retained worktree. |
| `ollama-claude-code:deepseek-v4-flash` | Passed | `run_20260513140232124_1ddbed52cdb2` | Completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, source unmodified, cleanup removed the retained worktree. |

## Claims Supported

- Codex can route selected Ollama Cloud models through the plugin's Claude Code adapter path.
- The selected profiles can run as `slice-implementer` only when fixture-local write validation and isolated worktree policy are enabled.
- Each selected profile can create the expected proof file inside the isolated execution worktree.
- The source checkout remains unmodified during the proof.
- Dashboard and summary evidence identify terminal runs and retained-worktree status before cleanup.
- Cleanup removes the retained implementation worktree after evidence is recorded.
- The auth gate fails closed when unrelated Anthropic token-shaped env vars could interfere with the intended provider route.

## Claims Not Made

- No comparative provider or model assessment.
- No benchmark or latency claim.
- No broad autonomous implementation readiness claim.
- No claim for untested Ollama profiles.
- No claim that these live proofs should run in CI.
