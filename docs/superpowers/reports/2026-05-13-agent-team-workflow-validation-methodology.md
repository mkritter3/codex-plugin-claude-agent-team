# Agent Team Workflow Validation Methodology

Date: 2026-05-13

## What CI Fixture Validation Proves

CI fixture validation proves workflow mechanics: phase progression, approval gates, bounded concurrency evidence, mailbox steering records, review gates, integration evidence, cleanup posture, and public-output sanitization.

It does not prove provider quality, model intelligence, broad coding ability, or comparative provider advantage.

## What Opt-In Live Validation Proves

Opt-in live validation proves specific transport capabilities for configured providers on the operator machine. A live report can prove that a provider accepted a task, wrote inside an isolated worktree, ran tests, returned evidence, or respected lifecycle controls.

Live validation reports must name the provider, command, model profile, run id, workflow id, worktree path, tests run, and cleanup state.

## Required Edge Cases

- provider missing authentication
- provider timeout
- degraded Opus senior review
- junior-provider bounded slice containment
- Gemini UI/frontend worker routing
- Codex CLI isolated write and test execution
- blocked dependency waiting
- mailbox steering during active run
- cancellation and wind-down
- conflicting write scopes
- failed tests in isolated worktree
- cleanup partial failure
- public-output sanitization

## Claim Boundaries

Fixture reports use `workflow_mechanics_only`.

Live provider reports use `provider_transport_capability_only` unless the report includes real task acceptance criteria, diff evidence, tests, senior review, and user-approved scope. Even then, the report may only claim that the tested workflow succeeded for that scenario.
