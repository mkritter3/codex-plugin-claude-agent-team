# Gemini CLI Autonomous Worker Design

## Goal

Make Gemini CLI a fully autonomous Agent Team worker for bounded implementation slices, with a default bias toward UI/UX and frontend work, while preserving Codex as orchestrator, reviewer, integrator, and final authority.

## Product Intent

Gemini should not be limited to read-only review. When explicitly enabled and validated, Codex can assign Gemini implementation work the same way it can assign Claude or Ollama-backed workers: a slice, an isolated worktree, permission to edit, verification expectations, and a retained diff for Codex review. The default routing should prefer Gemini for UI/UX, UX product critique, and frontend implementation where its strengths are most useful, while avoiding backend, security, DevOps, and integration ownership unless the user explicitly pins it.

## Safety Model

Gemini write capability is opt-in and evidence-gated:

- `providers.geminiCli.writeValidated` must be true before Gemini advertises `tools`, `edits`, `workspaceIsolation`, `sessionResume`, or `cancellation`.
- `writeMode.enabled` and `writeMode.requireIsolatedWorktree` remain required for write-capable roles.
- Gemini implementation runs write only inside retained isolated worktrees.
- Codex reviews and integrates the retained diff; the plugin does not auto-merge.
- Gemini CLI uses OAuth and never infers `GEMINI_API_KEY`.
- Headless automation must explicitly trust the workspace through `GEMINI_CLI_TRUST_WORKSPACE=true` or an equivalent operator-managed Gemini trust flow.
- Gemini CLI should use `--approval-mode auto_edit`, never `--yolo`, for autonomous implementation.

## Capability Contract

The milestone should implement the smallest honest autonomous worker contract:

- Start a Gemini CLI process through `startSession` for lifecycle-managed runs.
- Pass provider-neutral role, execution policy, model, timeout, and workspace cwd into the Gemini adapter.
- For read-only roles, use `--approval-mode plan`.
- For isolated implementation roles, use `--approval-mode auto_edit`.
- Capture stdout/stderr into the existing run log evidence path.
- Return `completed`, `failed`, `interrupted`, or `expired` through the existing lifecycle contract.
- Support cancellation through process termination.
- Mark `supportsStdin` false unless a separate interactive stdin protocol is proven.
- Treat resume/session continuity as capability-gated; advertise `sessionResume` only if the implemented `--session-id` path creates stable addressable runs in tests and live proof.

## Routing Policy

Gemini should be available as an implementation worker only when explicitly configured and validated. Recommended routing:

- `ui-ux-designer`: Gemini read-only review can be preferred through `rolePins`.
- `ux-product-critic`: Gemini read-only review can be preferred through `rolePins`.
- `frontend-engineer`: Gemini implementation can be preferred when `writeValidated` is true.
- `slice-implementer`: Gemini can run only when explicitly requested or pinned for UI/frontend slices by Codex.
- Backend, security, performance, DevOps, docs, and integration roles should not default to Gemini write mode.

## Live Proof

Add an opt-in Gemini write smoke that creates a disposable git fixture, enables Gemini write validation only inside that fixture, starts a `frontend-engineer` or `slice-implementer` run through packaged MCP stdio, proves a UI-focused file changed only in the isolated execution worktree, records dashboard/summary evidence, and cleans up the retained worktree.

Passing this proof validates Gemini isolated write containment for the selected profile only. It does not prove model quality, ranking, broad frontend excellence, or backend readiness.

## Non-Goals

- No Gemini API-key write mode.
- No broad provider ranking or model-quality claims.
- No automatic merge.
- No bypass/yolo permissions.
- No public MCP schema fields that expose provider-specific prompts, secrets, raw payloads, or command args.
- No claim that Gemini can be steered mid-flight until an interactive/resume path is separately proven.
