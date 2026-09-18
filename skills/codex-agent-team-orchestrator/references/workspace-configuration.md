# Workspace configuration migration

Perform this check before delegation in an older workspace and after a plugin update. Use the target project's root as `cwd` for every Agent Team call; the plugin installation directory is not the user's workspace.

## Inspect and persist

Read `.agent-team/config.json` when present, relevant Agent Team setup notes, and the selected workflow through `agent_team_get_workflow`. Compare them with the installed plugin's current configuration guidance and `agent_team_list_providers`. Missing config uses current defaults; create a file only when an override is needed. Preserve an unsupported future schema and update the plugin instead of downgrading the workspace.

Apply documented, mechanical migrations to the workspace file as part of the authorized Agent Team task. Preserve unrelated settings, custom profiles, disabled providers, model choices, allowlists, write-mode limits, worktree roots, and authentication policy. Keep a diff for tracked files or a local backup with the original file permissions for untracked config. Do not log secrets or commit local state/credentials. Read the file again before saving so another session's changes are not overwritten.

Update stale Agent Team setup snippets used by this workspace when they describe the retired transport; keep unrelated project guidance and historical reports intact. If an explicit current user choice conflicts with the migration or a replacement model is required, resolve that choice rather than guessing. A load-time compatibility alias is not a persisted migration.

## Gemini subscription transport: AGY

- Move `providers.geminiCli` to `providers.agy`. If both exist, the canonical `providers.agy` wins; do not merge legacy values over it. Remove the obsolete key after retaining a backup/diff.
- For a legacy block with `driver: "agy"`, preserve its executable path, configured model, disabled/enabled state, and AGY-specific validation settings. The redundant driver field may be omitted.
- For the retired Gemini CLI transport (missing driver or `driver: "gemini"`), set the executable to `agy`, remove `projectEnv` and the old driver field, set `writeValidated: false`, and clear old `tools`, `edits`, and `workspaceIsolation` claims. Preserve the model pin and enabled state; an old transport's write proof never validates AGY.
- Replace exact `gemini-cli` / `family:gemini-cli` selectors with `agy` / `family:agy` in `routing.rolePins`, `routing.providerOrder`, and `policy.allowedProviderSelectors`. Preserve order and every other selector; do not globally replace `gemini` in model IDs or the separate API-key REST adapter.
- Confirm a selected model with `agy models`. Keep it if available; report an unavailable pin instead of choosing another model. Do not enable API billing, write access, or run a live proof merely to pass preflight.

For example, a workspace already configured for AGY under the old key becomes:

```json
{
  "providers": {
    "agy": {
      "executable": "agy",
      "model": "gemini-3.8-flash-high",
      "displayName": "Gemini via AGY",
      "writeValidated": false
    }
  }
}
```

This is a merge example, not a replacement for the workspace's complete config.

## Saved workflows and sessions

Inspect the selected workflow's planning, review, and implementation targets as well as workspace routing. For a draft with no votes or started slices, use `agent_team_configure_orchestration` to replace old provider IDs with `agy`, retaining member IDs, exact models, and every other decision/implementation target. Let the server enforce whether membership can still change.

Once votes or slice execution have begun, preserve the old record and create a successor workflow with the intended current targets and fresh decision evidence. Do not hand-edit stored votes, run records, approvals, or execution evidence to rename their provider. Do not resume a `gemini-cli` session through AGY; start a new AGY run. Migrations do not dispatch models by themselves.

## Verify the running server

After persisting changes, rerun `agent_team_list_providers` and `agent_team_doctor` with the same target `cwd`. Check the exact provider/model, capabilities, and workspace policy before preparing assignments. Installed files and an already-running MCP server can differ: a server advertising `gemini-cli` is stale even if the files on disk are current. Reload the plugin or start a new Codex session and repeat the checks. Never restore old keys or launch the retired CLI to satisfy a stale server.

Report what changed, what the live server verified, and any remaining model/permission choice. Distinguish installed-package verification from verification of the current session's MCP connection.
