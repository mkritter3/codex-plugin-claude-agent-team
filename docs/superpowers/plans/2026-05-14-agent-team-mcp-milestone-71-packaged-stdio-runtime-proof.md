# Agent Team MCP Milestone 71 Packaged Stdio Runtime Proof Plan

**Goal:** Strengthen the packaged MCP smoke so it proves the built `dist/index.js` runtime exposes current doctor metadata and can create a read-only workflow slice with `writeScope: []`.

**Architecture:** Keep proof inside the existing CI-safe `smoke:mcp-stdio` path. The smoke should use public MCP tools through stdio, avoid live provider calls, and create only disposable state in a temporary workspace.

**Tech Stack:** Node.js ESM, MCP SDK stdio client, built `dist/index.js`, temporary filesystem workspace, existing package CI gate.

## Success Criteria

- `npm run smoke:mcp-stdio` calls `agent_team_doctor` through the packaged stdio server and asserts `mcp-runtime.details.workflowWriteScopeAllowsEmpty === true`.
- The same packaged stdio smoke calls `agent_team_create_workflow` with a read-only slice whose `dependencies` and `writeScope` are empty arrays.
- The smoke reads the workflow back and confirms the empty arrays survived the public MCP boundary.
- The smoke remains CI-safe, provider-free, and self-cleaning.
- The smoke output stays concise and does not expose prompts, secrets, provider payloads, or provider command details.

## Verification

- `npm run build`
- `npm run smoke:mcp-stdio`
- `npm test -- tests/package-runtime.test.ts tests/package-scripts.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
