# Agent Team Live Ollama Write Proof

Dates: 2026-05-13, 2026-06-28

## Decision

Native Ollama Claude Code write-mode proof passed for `ollama-claude-code:glm-5.2` and `ollama-claude-code:kimi-k2.7-code` on 2026-06-28 through the packaged MCP path and Ollama's native Claude Code launcher.

This report also records historical opt-in live-provider evidence for the earlier direct API-key-backed Ollama Claude Code route. It does not prove broad autonomous-coding readiness, benchmark performance, latency, comparative provider quality, comparative model quality, or practical long-context behavior.

## Native Proof Boundary

- Date: 2026-06-28.
- Provider paths: `ollama-claude-code:glm-5.2` and `ollama-claude-code:kimi-k2.7-code` through `launchMode: "ollama-launch"`.
- Models: `glm-5.2:cloud` and `kimi-k2.7-code:cloud`.
- Launcher: Ollama-native Claude Code launcher, `ollama launch claude`.
- Auth posture: locally authenticated Ollama installation; no `OLLAMA_API_KEY` required by this launch mode.
- Runtime boundary: installed `codex-plugin-claude-agent-team@0.1.3` packaged MCP stdio entrypoint.
- Workspace: disposable git fixture with `policy.liveSmokeEnabled: true`.
- Write mode: enabled only inside the disposable fixture with `writeValidated: true`.
- Isolation: retained git worktree verified before cleanup.
- Source safety: source fixture did not contain `OLLAMA_WRITE_PROOF.txt`.
- Cleanup: retained worktree removed through `agent_team_cleanup`.

## Native Commands

```bash
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:glm-5.2 --timeout-ms 300000 --max-wait-ms 360000
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:kimi-k2.7-code --timeout-ms 300000 --max-wait-ms 360000
```

## Native Results

| Provider selector | Result | Run id | Evidence |
| --- | --- | --- | --- |
| `ollama-claude-code:glm-5.2` | Passed | `run_20260628032425245_5115ff37db56` | Source package proof completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, content matched `ollama isolated write proof`, source unmodified, dashboard reported one terminal run, cleanup removed the retained worktree. |
| `ollama-claude-code:glm-5.2` | Passed | `run_20260628032942453_06ccb9fcb2ab` | Installed cache proof completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, content matched `ollama isolated write proof`, source unmodified, dashboard reported one terminal run, cleanup removed the retained worktree. |
| `ollama-claude-code:kimi-k2.7-code` | Passed | `run_20260628082454658_766aef479a82` | Installed cache proof completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, content matched `ollama isolated write proof`, source unmodified, dashboard reported one terminal run, cleanup removed the retained worktree. |
| `ollama-claude-code:kimi-k2.7-code` | Passed | `run_20260628082901278_155b7b48bc02` | Updated installed cache proof completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, content matched `ollama isolated write proof`, source unmodified, dashboard reported one terminal run, cleanup removed the retained worktree. |

## Historical Proof Boundary

- Provider path: historical `ollama-claude-code:<profile-id>` direct API route through Claude Code.
- Auth posture: explicit Ollama provider config with one plugin-level Ollama Cloud key in the operator environment.
- Runtime boundary: packaged MCP stdio entrypoint after `npm run build`.
- Workspaces: disposable git fixtures with `policy.liveSmokeEnabled: true`.
- Write mode: enabled only inside each disposable fixture with `writeValidated: true`.
- Isolation: each proof used a retained git worktree and then removed it through `agent_team_cleanup`.
- Source safety: each proof verified the source checkout did not contain `OLLAMA_WRITE_PROOF.txt`.
- Public reports: sanitized provider ids, run ids, statuses, sidecar/log paths, changed-file names, dashboard counts, and summary groups only.

## Historical Commands

```bash
npm run build
npm run smoke:ollama-write -- --dry-run --provider ollama-claude-code:kimi-k2.6 --provider ollama-claude-code:glm-5.1 --provider ollama-claude-code:deepseek-v4-flash
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:kimi-k2.6 --provider ollama-claude-code:glm-5.1 --provider ollama-claude-code:deepseek-v4-flash --timeout-ms 300000 --max-wait-ms 360000
```

The first confirmed run failed closed in `agent_team_doctor` because Anthropic token-shaped environment variables were present and API fallback is disabled. The successful run stripped those Anthropic token-shaped variables while preserving the Ollama Cloud key.

## Historical Results

| Provider selector | Result | Run id | Evidence |
| --- | --- | --- | --- |
| `ollama-claude-code:kimi-k2.6` | Passed | `run_20260513140110838_28860808f492` | Completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, source unmodified, cleanup removed the retained worktree. |
| `ollama-claude-code:glm-5.1` | Passed | `run_20260513140212429_5478e31e940e` | Completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, source unmodified, cleanup removed the retained worktree. |
| `ollama-claude-code:deepseek-v4-flash` | Passed | `run_20260513140232124_1ddbed52cdb2` | Completed with `SHIP`, changed only `OLLAMA_WRITE_PROOF.txt`, source unmodified, cleanup removed the retained worktree. |

## Claims Supported

- Codex can route selected Ollama Cloud models through the plugin's Claude Code adapter path.
- The selected native `ollama-launch` profiles can run as `slice-implementer` when exact write validation and isolated worktree policy are enabled; this proof used disposable fixtures and does not prove direct-api write mode.
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
