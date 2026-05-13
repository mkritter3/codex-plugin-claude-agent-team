# Agent Team Live Claude Provider Proof

Date: 2026-05-13

## Decision

Live Claude Code CLI provider proof passed for the accepted evidence scope.

This report records opt-in live-provider evidence only. It does not make a benchmark, model-quality, provider-ranking, long-context, or broad autonomous-coding-readiness claim.

## Proof Boundary

- Transport: Claude Code CLI.
- Auth posture: subscription OAuth; Anthropic API-token environment variables were stripped from the live smoke process.
- Runtime boundary: packaged MCP stdio entrypoint after `npm run build`.
- Workspaces: disposable git fixtures with `policy.liveSmokeEnabled: true`.
- Write mode: enabled only for the capability-matrix fixture and restricted to canonical retained worktree roots.
- Public reports: sanitized run ids, statuses, sidecar/log paths, changed-file names, dashboard counts, and summary groups only.

## Commands

```bash
npm run build
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN npm run smoke:claude-live -- --confirm-live-provider-use --cwd /tmp/agent-team-claude-live-basic-1qGjs7 --timeout-ms 180000 --max-wait-ms 240000
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN npm run smoke:claude-models -- --confirm-live-provider-use --timeout-ms 240000
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN npm run smoke:claude-live-matrix -- --confirm-live-provider-use --cwd /tmp/agent-team-claude-live-matrix-ccOhFh --timeout-ms 240000 --max-wait-ms 300000
```

## Results

| Proof | Result | Evidence |
| --- | --- | --- |
| Basic live Claude team smoke | Passed | Direct dispatch completed with `SHIP`; parallel planner and code-reviewer runs completed; dashboard reported 2 terminal runs and 0 failed runs. |
| Claude model profile smoke | Passed | `claude-code-cli:opus`, `claude-code-cli:sonnet`, and `claude-code-cli:haiku` all routed through explicit profile ids and reached terminal `completed` status. |
| Claude live capability matrix | Passed | Direct dispatch, bounded parallel read-only starts, isolated implementation worktree, mailbox delivery, wind-down, cancellation, team record, dashboard, summary, cleanup, and policy-failure proof all completed. |

## Notable Evidence

- Basic live run used provider `claude-code-cli` with `authMode: subscription-oauth`.
- Direct proof run id: `run_20260513135113103_b647090ee3a8`.
- Parallel proof run ids:
  - `run_20260513135122169_672e71a67454`
  - `run_20260513135122169_d8aa1b70c458`
- Model profile proof run ids:
  - Opus: `run_20260513135138042_16c3530ddab8`
  - Sonnet: `run_20260513135153262_73dad56b36f1`
  - Haiku: `run_20260513135244462_ab18abbf5a68`
- Capability matrix implementation run id: `run_20260513135502573_278b3c6725b7`.
- Capability matrix mailbox run id: `run_20260513135513841_40a4477adfa1`.
- Capability matrix wind-down run id: `run_20260513135532383_f7d0f866230c`.
- Capability matrix cancel run id: `run_20260513135541891_5b6f9161a6bd`.

## Nuance

The Opus profile route reached Claude and completed, but the model returned an `INCONCLUSIVE` verdict for the route-proof task. That is not a transport failure. It means this proof supports "Opus alias routing and completion reached Claude Code CLI," not "Opus signed off on product quality."

The first capability-matrix attempt failed closed with `worktree_root_not_allowed` because the disposable fixture allowed a `/tmp/...` worktree root while git resolved the source root under `/private/tmp/...`. The rerun used the canonical retained worktree root and passed. This is useful operator evidence: policy root restrictions are strict, and live fixtures should use canonical paths.

## Claims Supported

- Codex can call Claude through the plugin's packaged MCP stdio entrypoint.
- Claude Code CLI subscription-OAuth transport works for direct dispatch.
- Bounded parallel read-only Claude runs work.
- Claude profile selectors for `opus`, `sonnet`, and `haiku` route through explicit provider ids.
- Isolated implementation worktrees work with real Claude Code CLI runs when policy enables write mode and allows the canonical retained worktree root.
- Mailbox delivery, wind-down, cancellation, dashboard, summary, cleanup, and policy blocking work under a real Claude provider session.

## Claims Not Made

- No comparative provider or model assessment.
- No benchmark or latency claim.
- No broad autonomous implementation readiness claim.
- No guarantee that Opus, Sonnet, or Haiku map to any dated model id; Claude Code resolves those aliases.
- No claim that live proof should run in CI.
