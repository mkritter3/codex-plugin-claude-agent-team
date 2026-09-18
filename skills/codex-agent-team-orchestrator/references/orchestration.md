# Native and cross-provider orchestration

Create a workflow, then call `agent_team_configure_orchestration` before the first vote. This policy is specific to that workflow. It does not change the active Codex model or account settings.

## Economical default

Keep the user's chosen coordinator. Use a single Astra planning/review seat unless the user requests a panel. Choose the implementation model for the task; the example uses Sol. Terra and Luna are also supported native targets. Model and effort support is validated against this host's known model catalog; if the host lacks a selected model, report that instead of substituting.

```json
{
  "workflowId": "workflow_feature",
  "cwd": "/absolute/project",
  "policy": {
    "planning": {"members": [{"id": "astra", "target": {"kind": "native", "model": "gpt-6-astra", "reasoningEffort": "xhigh"}}]},
    "review": {"members": [{"id": "astra", "target": {"kind": "native", "model": "gpt-6-astra", "reasoningEffort": "high"}}]},
    "implementation": {"kind": "native", "model": "gpt-5.6-sol", "reasoningEffort": "medium"}
  }
}
```

To select a panel, add members to the applicable phase. For example, add `{"id":"opus","target":{"kind":"provider","provider":"claude-code-cli:opus"}}` and a configured Gemini profile `{"id":"gemini","target":{"kind":"provider","provider":"agy"}}`. Fable, Sonnet, GLM, Kimi and DeepSeek use exact configured profile IDs from `agent_team_list_providers`; never invent model availability. Provider decision seats require a configured model. Configuration resolves and stores that model, and rejects duplicate seats for the same resolved model. Use canonical model IDs; the plugin cannot discover every vendor alias.

One selected member has decision authority. Multiple selected members require **all** approvals on the **same immutable artifact**. The coordinator's `codexDecision` records rationale; it cannot override this policy. Missing votes, abstention, error and revise do not approve. A block prevents approval. A round limit never converts dissent into approval. The existing maximum is ten rounds normally, fifteen in explicitly extended mode; finish as soon as the gate passes, and escalate unresolved disagreement without running empty rounds. Membership freezes after voting begins; create a new workflow if the user changes it.

## Prepare and execute

Call `agent_team_prepare_assignments` with `phase: "planning"`, `"review"` or `"implementation"`. Review and implementation require `sliceId`. For implementation only, an optional `target` overrides the default for that slice. This lets the user select active Astra for visual work or any other supported model without changing planning/review authority.

Supply `coordinator` only from the host's actual runtime identity:

```json
{"source":"runtime","sessionId":"current-session-id","model":"gpt-6-astra","reasoningEffort":"xhigh"}
```

Never infer the active model from the plugin's defaults, global config, a previous turn, or the model the user hopes to use. If unavailable, omit coordinator identity or use `source: "unknown"`. When model **and effort** match, planning or implementation returns `active-session`, so perform the assignment in the active session once. A different or unknown effort does not pretend to satisfy an explicit xhigh request. If the user accepts the active effort, select that actual effort in the planning policy before voting. Code review always returns a separate execution, even if the coordinator is Astra, to preserve independent review.

For `native-agent`, use the host's native agent tools with the returned model and reasoning effort. In hosts exposing `collaboration.spawn_agent`, map `reasoningEffort` to `reasoning_effort`, use `fork_turns: "none"`, and send a concise bounded task. Do not use `create_thread` for these subtasks. Do not fork the entire history into every worker. The MCP server prepares and records native work; it cannot launch or inspect host-native agents itself.

For `provider`, use the returned `route.tool`, role and exact provider ID. Resumable CLIs use `agent_team_start`; chat-only APIs use `agent_team_dispatch`. Both produce durable run IDs for authority evidence. External implementations use `agent_team_start_slices`, which honors the selected per-slice provider. An Ollama chat API profile supports advice; tool-enabled implementations need the Ollama Claude Code profile. An unavailable selected provider is a blocker, not permission to replace a panel member.

Include the goal, write/read scopes, acceptance tests, relevant source paths and artifact digest. Ask the worker for concise findings, changed files, tests with outcomes, retained worktree path and remaining risks. Keep implementation in retained isolated worktrees, including active-session work; never run two writers in one checkout. Record workflow mutations serially even if workers run concurrently. Native steering/status/cancellation use the host's agent tools; external runs use Agent Team lifecycle tools. Do not claim MCP mailboxes control native agents.

## Record evidence

After a native implementation completes, call `agent_team_record_native_implementation` with `workflowId`, `sliceId`, `cwd`, and `evidence`:

```json
{
  "execution": {"kind":"native-agent","id":"returned-host-agent-id","target":{"kind":"native","model":"gpt-5.6-sol","reasoningEffort":"medium"}},
  "artifact":"git:exact-commit-or-sha256-of-complete-diff",
  "summary":"Implemented the bounded feature",
  "changedFiles":["src/feature.ts"],
  "testsRun":["focused feature tests: passed"],
  "evidencePaths":["/absolute/test-output.txt"],
  "worktreePath":"/absolute/retained-worktree"
}
```

Use `kind: "active-session"` and its actual session ID for an active implementation. This tool records completion; it does not run tests, create a worktree or independently verify a native model's identity. The coordinator must inspect the actual diff and test output first. The result enters the ordinary review/integration queue. Retain native worktrees with host/git tools until integration evidence is saved; `agent_team_cleanup` owns external runs only.

For external implementation review, include `artifact` in the existing `implementationEvidence`. For both kinds, `agent_team_review_slice` requires an `authority` object; planning uses the same object on `agent_team_plan_consensus`:

```json
{
  "artifact":"git:exact-commit-or-sha256-of-complete-diff",
  "votes":[{
    "memberId":"astra",
    "status":"approve",
    "artifact":"git:exact-commit-or-sha256-of-complete-diff",
    "summary":"Acceptance criteria and failure cases covered",
    "execution":{"kind":"native-agent","id":"separate-review-agent-id","target":{"kind":"native","model":"gpt-6-astra","reasoningEffort":"high"}}
  }]
}
```

Use `provider-run` plus the actual `run_...` ID, canonical provider ID and resolved model for external votes. An external approval must reference a completed matching run. Native IDs/model/effort and artifact digests are host attestations, not cryptographic verification. Do not fabricate them. One execution cannot supply multiple panel votes. Active-session review or review by the native implementer's ID is rejected. The existing role `verdicts` and `codexDecision` fields remain required as supporting evidence, not additional voters. Before integration, recompute the commit/diff digest; changes since approval require fresh votes. Submit the complete current round, never reuse stale votes on a changed revision.

## Claude sessions and AGY

Claude Code manages prompt caching. Agent Team already keeps stable role definitions and supports resuming the same provider session; prefer `agent_team_reply` for follow-up in the same role/model and send only changed evidence. Keep instructions and tool definitions stable, and avoid restarting large contexts. Caching reduces repeated input work; it does not eliminate subscription usage. See [Anthropic's cost guidance](https://code.claude.com/docs/en/costs).

Gemini subscription runs use the `agy` provider through Antigravity CLI. In the target workspace's `.agent-team/config.json`, merge:

```json
{"providers":{"agy":{"executable":"agy","model":"gemini-3.8-flash-high","displayName":"Gemini via AGY","writeValidated":false}}}
```

Verify available IDs with `agy models`. Planning/review uses AGY's plan mode and sandbox; the adapter captures the returned conversation ID for subsequent turns. Implementation uses accept-edits in an isolated worktree after explicit write validation enables the normal tools/edits/isolation capabilities. Do not assert live write validation from mocked tests. The adapter does not disable permission checks; denied actions fail the run and remain visible in its log. Legacy `providers.geminiCli` configuration and `gemini-cli` selectors migrate to `agy`; old CLI write validation does not transfer, and legacy sessions require a new run. There is no old CLI fallback. Keep CLI updates outside active runs; `claude update` and `agy update` are manual maintenance commands, not per-task model calls.

Existing workflows without `orchestration` retain their legacy behavior. Start a configured workflow for these authority and routing guarantees; do not retroactively rewrite old approvals.
