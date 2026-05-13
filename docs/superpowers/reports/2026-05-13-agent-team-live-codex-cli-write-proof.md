# Live Codex CLI Isolated Write Proof

Date: 2026-05-13

This report records opt-in live-provider evidence for the `codex-cli` adapter only. It does not make a provider ranking, model-quality, broad autonomous-implementation, or broad write-readiness claim.

## Scope

- Provider selector: `codex-cli`
- Selected provider id: `codex-cli`
- Auth mode: `subscription-oauth`
- Model configured for proof workspace: `gpt-5.5`
- Role: `slice-implementer`
- Execution policy: isolated edit
- Isolation mode: retained git worktree
- Verification command: `npm test`
- MCP entrypoint: packaged `dist/index.js`

## Result

The packaged MCP stdio server successfully:

- loaded a disposable git workspace with write mode enabled only for the fixture
- required `writeValidated: true`, explicit write capabilities, and an allowed worktree root
- selected `codex-cli` through `agent_team_start`
- created a retained isolated git worktree for the implementation run
- let the Codex CLI worker modify files inside the execution worktree
- observed provider completion with verdict `SHIP`
- verified the implementation file, test file, and proof file existed in the execution worktree
- verified the run log mentioned `npm test`
- independently ran `npm test` inside the execution worktree and observed success
- verified the source workspace stayed unmodified for the fixture source, tests, and proof file paths
- removed the retained worktree through `agent_team_cleanup`

Proof run id:

- `run_20260513195631428_3ed847e3f95f`

Sanitized smoke summary:

```json
{
  "status": "completed",
  "liveProviderUse": true,
  "providerSelectors": ["codex-cli"],
  "authMode": "subscription-oauth",
  "model": "gpt-5.5",
  "proofs": [
    {
      "providerSelector": "codex-cli",
      "status": "completed",
      "runStatus": "completed",
      "verdict": "SHIP",
      "workspaceIsolation": "git-worktree",
      "workspaceCleanup": "retained",
      "changedFiles": ["src/math.js", "TEST_RUN_PROOF.txt", "tests/"],
      "proofState": {
        "executionHasImplementation": true,
        "executionHasTest": true,
        "executionHasProof": true,
        "sourceUnmodified": true,
        "logMentionsNpmTest": true,
        "independentNpmTestPassed": true
      },
      "cleanup": {
        "status": "removed"
      }
    }
  ]
}
```

## Boundaries

- This proof validates one live `codex-cli` isolated write run in a disposable fixture.
- This proof validates that tests can be run inside the isolated execution worktree.
- This proof validates cleanup of the retained worktree after evidence collection.
- This proof does not broaden write validation to every Codex model or every repository.
- Production workspace config should still keep explicit `allowedWorktreeRoots`, `allowWriteMode`, and `writeValidated` controls.
