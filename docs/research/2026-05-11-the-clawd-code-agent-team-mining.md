# The Clawd Code Agent Team Mining Notes

**Source inspected:** `/Users/mkr/Documents/coding-projects/third-party-projects/the-clawd-code/src`

**Purpose:** Extract proven agent-team lifecycle patterns that should shape `codex-plugin-claude-agent-team` without transplanting Clawd's runtime-specific contracts.

---

## Direct Takeaways

1. **Background agents need a session handle, not just an abort signal.**
   - `bridge/types.ts:178-189` defines a `SessionHandle` with `done`, `kill`, `forceKill`, recent `activities`, `currentActivity`, `lastStderr`, `writeStdin`, and token refresh.
   - `bridge/sessionRunner.ts:333-340` spawns a long-lived child with `stdin`, `stdout`, and `stderr` pipes.
   - `bridge/sessionRunner.ts:448-480` resolves a typed `completed | failed | interrupted` outcome from process close/error.
   - `bridge/sessionRunner.ts:491-517` separates soft kill from force kill because `child.killed` only means a signal was sent.
   - `tasks/LocalAgentTask/LocalAgentTask.tsx:116-148` keeps live runtime fields such as `abortController`, cleanup callbacks, pending messages, and retention state on task state, not inside transcript output.

2. **Stream-json is the right background transport shape.**
   - `bridge/sessionRunner.ts:287-304` runs print mode with `--input-format stream-json` and `--output-format stream-json`.
   - `bridge/sessionRunner.ts:368-445` parses stdout as NDJSON, writes transcript lines, extracts activity summaries, and detects `control_request` events.
   - For this project, synchronous `agent_team_dispatch` can keep `claude -p --output-format json`; background `agent_team_start` should use a separate spawn-based stream adapter.

3. **Recent activity and stderr rings should be first-class status fields.**
   - `bridge/sessionRunner.ts:16-17` caps activities and stderr lines.
   - `bridge/sessionRunner.ts:346-365` keeps bounded status diagnostics instead of forcing callers to tail full logs.
   - Our status sidecar should expose bounded `recentActivities`, `currentActivity`, and `lastStderr` while preserving full transcript/log paths.

4. **Mailboxes need serialized writes.**
   - `utils/teammateMailbox.ts:31-41` defines retrying lock options for concurrent swarms.
   - `utils/teammateMailbox.ts:134-180` creates the inbox if missing, acquires a lock, re-reads under lock, appends, and writes the result.
   - Our current mailbox store computes `sequence` from `existing.length + 1` before append. Milestone 3 should add lock-protected appends before live control/message APIs depend on ordering.

5. **State transitions should be guarded against stale async writes.**
   - `Task.ts:22-29` centralizes terminal-status detection.
   - `utils/task/framework.ts:158-164` avoids spreading stale full task snapshots after async disk reads.
   - `utils/task/framework.ts:208-248` applies offset patches against fresh state and re-checks terminal conditions.
   - `tools/AgentTool/agentToolUtils.ts:597-604` marks async agents completed before slower classifier/worktree notification embellishments so readers unblock quickly.
   - `tools/AgentTool/agentToolUtils.ts:640-668` does the same for aborts: transition killed first, then emit partial-result notification.
   - Our run sidecar store should gain legal transition helpers so a late running/completed write cannot overwrite `cancelled`, `failed`, or another terminal state.

6. **Stop is shared business logic, not tool-specific glue.**
   - `tools/TaskStopTool/TaskStopTool.ts:39-130` is thin validation and output formatting.
   - `tasks/stopTask.ts:31-99` owns task lookup, running validation, kill dispatch, and notification semantics.
   - Our MCP tools should stay thin and delegate lifecycle behavior to a shared lifecycle manager.

7. **Nested teams need explicit topology constraints.**
   - `tools/AgentTool/AgentTool.tsx:266-280` rejects teammates spawning nested teammates and blocks in-process teammates from background agents.
   - This project should avoid exposing nested live-agent messaging until provider session resume/live input semantics are proven.

8. **Message delivery is its own protocol.**
   - `tasks/LocalAgentTask/LocalAgentTask.tsx:162-167` queues pending messages instead of blindly writing them into a running turn.
   - `tools/SendMessageTool/SendMessageTool.ts:604-718` has substantial validation for addressing, broadcast, cross-session, shutdown-response, and structured-message constraints.
   - `bridge/remoteBridgeCore.ts:762-850` deduplicates, gates history flushing, reports running/requires-action state, and separates control requests from message writes.
   - This strongly supports deferring `agent_team_message` and `agent_team_reply` until our own protocol is designed.

9. **Provider/tool inheritance must be deliberate.**
   - `tools/AgentTool/runAgent.ts:85-218` initializes agent-specific MCP servers, merges them with parent clients, and returns cleanup for newly created clients only.
   - `tools/shared/spawnMultiAgent.ts:200-259` propagates permission mode, model, settings, plugins, and browser flags with plan-mode safety.
   - Our v1 stays read-only and provider-neutral, but the provider lifecycle interface should leave room for future capability-specific tool surfaces.

10. **Restart/orphan behavior must be explicit.**
   - Clawd has in-memory handles for live controllers and separate persisted/transcript state.
   - For this project, an MCP server restart cannot magically reattach to an old child process unless we explicitly build session reattachment. Milestone 3 status should report a clear detached/orphaned warning when a sidecar says `running` but the active handle map has no handle.

## Do Not Transplant

- Clawd's task model is tied to its React/Ink app state, SDK event queues, tmux/in-process teammate backends, and remote-control environment API.
- Prior local memory also flags Clawd's inspected `src/` snapshot as a source of ideas, not a drop-in replacement.
- We should mine its lifecycle shape, not copy its runtime-specific UI, environment registration, or provider contracts.

## Shape For Our Milestone 3

Milestone 3 should build:

- provider-neutral `ProviderSessionHandle`
- spawn-based Claude stream adapter for background read-only sessions
- lifecycle manager with active handle registry
- transition-aware run sidecar writes
- lock-protected mailbox/control appends
- status reconciliation from active handle plus persisted sidecar
- soft cancel plus hard-kill cleanup
- wind-down as a recorded control request, with live stdin delivery only when supported

`agent_team_message` and `agent_team_reply` should remain deferred until mailbox ordering, provider resume, and live input semantics are proven.
