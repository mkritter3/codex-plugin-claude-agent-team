import { z } from "zod";
import type { ToolName } from "./tools.js";

const role = z
  .enum([
    "architect",
    "planner",
    "ui-ux-designer",
    "frontend-engineer",
    "backend-engineer",
    "slice-implementer",
    "code-reviewer",
    "test-designer",
    "qa-engineer",
    "test-hardening-engineer",
    "security-reviewer",
    "performance-reviewer",
    "devops-release-engineer",
    "docs-dx-writer",
    "integration-engineer",
    "debugger",
    "ux-product-critic"
  ])
  .describe("Agent role to run.");

const cwd = z.string().min(1).optional().describe("Workspace root. Defaults to server cwd.");
const provider = z.string().min(1).optional().describe("Preferred provider selector.");
const timeoutMs = z.number().positive().optional().describe("Positive timeout in milliseconds.");
const runId = z.string().min(1).describe("Agent Team run id.");
const teamId = z
  .string()
  .regex(/^team_[A-Za-z0-9_-]+$/)
  .describe("Agent Team record id.");
const message = z.string().min(1).describe("Message content.");
const messageType = z.string().min(1).optional().describe("Mailbox message type.");
const correlationId = z.string().min(1).optional().describe("Caller correlation id.");
const force = z
  .boolean()
  .describe("Explicit confirmation required before removing a retained implementation worktree.");

const dispatchInputSchema = {
  role,
  task: z.string().min(1).describe("Bounded assignment for the role."),
  cwd,
  provider,
  timeoutMs
};

const parallelRunInputSchema = z.object({
  role,
  task: z.string().min(1).describe("Bounded assignment for the role."),
  cwd,
  provider,
  timeoutMs,
  correlationId
});

const parallelStartInputSchema = {
  runs: z.array(parallelRunInputSchema).min(1),
  cwd,
  provider,
  timeoutMs,
  concurrency: z.number().int().min(1).max(8).optional()
};

const replyInputSchema = {
  runId,
  cwd,
  message: message.optional(),
  messageType,
  correlationId,
  provider,
  timeoutMs
};

const messageInputSchema = {
  runId,
  cwd,
  message,
  messageType,
  correlationId
};

const messageManyItemInputSchema = z.object({
  runId,
  cwd,
  message,
  messageType,
  correlationId
});

const messageManyInputSchema = {
  messages: z.array(messageManyItemInputSchema).min(1),
  cwd,
  concurrency: z.number().int().min(1).max(8).optional()
};

const statusInputSchema = {
  runId,
  cwd
};

const statusManyRunInputSchema = z.object({
  runId,
  cwd,
  correlationId
});

const statusManyInputSchema = {
  runs: z.array(statusManyRunInputSchema).min(1),
  cwd,
  concurrency: z.number().int().min(1).max(8).optional()
};

const summaryRunInputSchema = z.object({
  runId,
  cwd,
  correlationId
});

const summaryInputSchema = {
  runs: z.array(summaryRunInputSchema).min(1),
  cwd,
  concurrency: z.number().int().min(1).max(8).optional()
};

const teamRunInputSchema = z.object({
  runId,
  cwd,
  correlationId
});

const createTeamInputSchema = {
  runs: z.array(teamRunInputSchema).min(1),
  cwd,
  name: z.string().min(1).optional().describe("Human-readable team name."),
  description: z.string().min(1).optional().describe("Short team description.")
};

const getTeamInputSchema = {
  teamId,
  cwd
};

const listTeamsInputSchema = {
  cwd
};

const workflowId = z
  .string()
  .regex(/^workflow_[A-Za-z0-9_-]+$/)
  .describe("Agent Team workflow id.");

const workflowGoalInputSchema = z.object({
  title: z.string().min(1),
  successCriteria: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)).min(1),
  nonGoals: z.array(z.string().min(1)).min(1)
});

const workflowSliceInputSchema = z.object({
  sliceId: z.string().min(1),
  title: z.string().min(1),
  ownerRole: role,
  state: z.enum(["planned", "blocked", "ready"]).optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  writeScope: z.array(z.string().min(1)),
  readScope: z.array(z.string().min(1)).min(1).optional(),
  acceptanceTests: z.array(z.string().min(1)).min(1),
  expectedEvidence: z.array(z.string().min(1)).min(1),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  requiredReviewers: z.array(z.string().min(1)).min(1).optional(),
  integrationOrderHint: z.number().int().positive().optional(),
  blockedMode: z.enum(["deferred-start", "prep-then-wait"]).optional()
});

const createWorkflowInputSchema = {
  goal: workflowGoalInputSchema,
  slices: z.array(workflowSliceInputSchema),
  cwd,
  workflowId: workflowId.optional(),
  name: z.string().min(1).optional(),
  rationale: z.string().min(1).optional()
};

const getWorkflowInputSchema = {
  workflowId,
  cwd
};

const listWorkflowsInputSchema = {
  cwd
};

const consensusDecisionCategory = z.enum([
  "technical",
  "product-behavior",
  "user-trust",
  "security-risk",
  "provider-cost",
  "release-posture"
]);

const consensusVerdictInputSchema = z.object({
  reviewerRole: role,
  reviewerProvider: z.string().min(1).optional(),
  status: z.enum(["approve", "revise", "block", "abstain"]),
  summary: z.string().min(1),
  evidenceRunId: z.string().regex(/^run_[A-Za-z0-9_-]+$/).optional()
});

const codexDecisionInputSchema = z.object({
  status: z.enum(["approve", "revise", "block"]),
  category: consensusDecisionCategory,
  summary: z.string().min(1),
  relatedSliceIds: z.array(z.string().min(1)).min(1).optional()
});

const seniorReviewerEvidenceInputSchema = z.object({
  status: z.enum(["available", "unavailable", "skipped"]),
  provider: z.string().min(1).optional(),
  runId: z.string().regex(/^run_[A-Za-z0-9_-]+$/).optional(),
  summary: z.string().min(1)
});

const userEscalationInputSchema = z.object({
  category: z.enum([
    "product-behavior",
    "user-trust",
    "security-risk",
    "provider-cost",
    "release-posture"
  ]),
  question: z.string().min(1),
  productImpact: z.string().min(1),
  options: z.array(z.string().min(1)).min(1)
});

const planConsensusInputSchema = {
  workflowId,
  cwd,
  roundMode: z.enum(["default", "extended"]).optional(),
  codexDecision: codexDecisionInputSchema,
  verdicts: z.array(consensusVerdictInputSchema).min(1),
  seniorReviewerEvidence: seniorReviewerEvidenceInputSchema.optional(),
  userEscalations: z.array(userEscalationInputSchema).optional()
};

const startSlicesInputSchema = {
  workflowId,
  cwd,
  sliceIds: z.array(z.string().min(1)).min(1).optional(),
  provider,
  timeoutMs,
  concurrency: z.number().int().min(1).max(8).optional()
};

const dependencyEvidenceInputSchema = z.object({
  dependencySliceId: z.string().min(1),
  summary: z.string().min(1),
  changedFiles: z.array(z.string().min(1)).min(1).optional(),
  evidencePaths: z.array(z.string().min(1)).min(1).optional(),
  sourceRunId: z.string().regex(/^run_[A-Za-z0-9_-]+$/).optional()
});

const unblockSliceInputSchema = {
  workflowId,
  sliceId: z.string().min(1),
  dependencyEvidence: z.array(dependencyEvidenceInputSchema).min(1),
  cwd,
  notifyRunIds: z.array(z.string().regex(/^run_[A-Za-z0-9_-]+$/)).min(1).optional(),
  message: z.string().min(1).optional(),
  correlationId,
  concurrency: z.number().int().min(1).max(8).optional()
};

const implementationEvidenceInputSchema = z.object({
  summary: z.string().min(1),
  changedFiles: z.array(z.string().min(1)),
  testsRun: z.array(z.string().min(1)).min(1),
  evidencePaths: z.array(z.string().min(1)).min(1),
  sourceRunId: z.string().regex(/^run_[A-Za-z0-9_-]+$/).optional(),
  worktreePath: z.string().min(1).optional(),
  knownRisks: z.array(z.string().min(1)).min(1).optional()
});

const reviewSliceInputSchema = {
  workflowId,
  sliceId: z.string().min(1),
  cwd,
  roundMode: z.enum(["default", "extended"]).optional(),
  implementationEvidence: implementationEvidenceInputSchema.optional(),
  codexDecision: codexDecisionInputSchema,
  verdicts: z.array(consensusVerdictInputSchema).min(1),
  seniorReviewerEvidence: seniorReviewerEvidenceInputSchema.optional(),
  userEscalations: z.array(userEscalationInputSchema).optional()
};

const integrationQueueInputSchema = {
  workflowId,
  cwd,
  sliceIds: z.array(z.string().min(1)).min(1).optional()
};

const verificationInputSchema = z.object({
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  summary: z.string().min(1),
  evidencePath: z.string().min(1).optional()
});

const recordIntegrationInputSchema = {
  workflowId,
  sliceId: z.string().min(1),
  cwd,
  integrationMethod: z.string().min(1),
  summary: z.string().min(1),
  changedFiles: z.array(z.string().min(1)).min(1),
  verification: z.array(verificationInputSchema).min(1),
  evidencePaths: z.array(z.string().min(1)).min(1).optional(),
  retainedWorktreePath: z.string().min(1).optional(),
  cleanupRecommendation: z
    .enum([
      "retain-for-review",
      "eligible-after-evidence-saved",
      "manual-cleanup-required"
    ])
    .optional()
};

const workflowReportInputSchema = {
  workflowId,
  cwd,
  includeWorkflow: z.boolean().optional()
};

const workflowNextInputSchema = {
  workflowId,
  cwd,
  includeSteering: z.boolean().optional(),
  includeRolePolicy: z.boolean().optional()
};

const workflowUserDecisionInputSchema = {
  workflowId,
  cwd,
  decisionId: z.string().min(1).optional(),
  category: z.enum(["product", "trust", "cost", "release", "permission", "user_impact"]),
  decision: z.enum(["approve", "reject", "defer", "choose_option"]),
  summary: z.string().min(1),
  practicalEffect: z.string().min(1),
  selectedOption: z.string().min(1).optional()
};

const dashboardInputSchema = {
  teamId: teamId
    .optional()
    .describe("Exactly one dashboard source is required: teamId or runs."),
  runs: z
    .array(teamRunInputSchema)
    .min(1)
    .optional()
    .describe("Exactly one dashboard source is required: teamId or runs."),
  cwd,
  concurrency: z.number().int().min(1).max(8).optional()
};

const cleanupInputSchema = {
  runId,
  cwd,
  force
};

const cancelManyRunInputSchema = z.object({
  runId,
  cwd,
  correlationId
});

const cancelManyInputSchema = {
  runs: z.array(cancelManyRunInputSchema).min(1),
  cwd,
  concurrency: z.number().int().min(1).max(8).optional()
};

const windDownManyRunInputSchema = z.object({
  runId,
  cwd,
  correlationId
});

const windDownManyInputSchema = {
  runs: z.array(windDownManyRunInputSchema).min(1),
  cwd,
  concurrency: z.number().int().min(1).max(8).optional()
};

const cwdOnlyInputSchema = {
  cwd
};

export interface ToolMetadata {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodTypeAny> | z.ZodObject<Record<string, never>>;
}

export const TOOL_METADATA_BY_NAME = {
  agent_team_dispatch: {
    title: "Dispatch Agent",
    description: "Run one read-only role against one bounded assignment.",
    inputSchema: dispatchInputSchema
  },
  agent_team_start: {
    title: "Start Agent Session",
    description: "Start a durable role session with status and mailbox state.",
    inputSchema: dispatchInputSchema
  },
  agent_team_start_parallel: {
    title: "Start Agent Team",
    description: "Start multiple durable role sessions with bounded concurrency.",
    inputSchema: parallelStartInputSchema
  },
  agent_team_reply: {
    title: "Reply To Agent Session",
    description: "Continue a durable session using recorded mailbox context.",
    inputSchema: replyInputSchema
  },
  agent_team_message: {
    title: "Message Agent Session",
    description: "Record or deliver an in-flight message to a run.",
    inputSchema: messageInputSchema
  },
  agent_team_message_many: {
    title: "Message Agent Sessions",
    description: "Record or deliver in-flight messages to multiple runs with bounded concurrency.",
    inputSchema: messageManyInputSchema
  },
  agent_team_status: {
    title: "Get Agent Status",
    description: "Read current durable state for a run.",
    inputSchema: statusInputSchema
  },
  agent_team_status_many: {
    title: "Get Agent Statuses",
    description: "Read current durable state for multiple runs with bounded concurrency.",
    inputSchema: statusManyInputSchema
  },
  agent_team_summary: {
    title: "Summarize Agent Team",
    description: "Read grouped operational state and evidence pointers for multiple runs.",
    inputSchema: summaryInputSchema
  },
  agent_team_create_team: {
    title: "Create Agent Team Record",
    description: "Create a durable team record that groups run ids as metadata.",
    inputSchema: createTeamInputSchema
  },
  agent_team_get_team: {
    title: "Get Agent Team Record",
    description: "Read one durable team record by id.",
    inputSchema: getTeamInputSchema
  },
  agent_team_list_teams: {
    title: "List Agent Team Records",
    description: "List durable team records for a workspace.",
    inputSchema: listTeamsInputSchema
  },
  agent_team_create_workflow: {
    title: "Create Agent Workflow",
    description: "Create a durable workflow record from a goal packet and initial slice DAG.",
    inputSchema: createWorkflowInputSchema
  },
  agent_team_get_workflow: {
    title: "Get Agent Workflow",
    description: "Read a sanitized durable workflow view by id.",
    inputSchema: getWorkflowInputSchema
  },
  agent_team_list_workflows: {
    title: "List Agent Workflows",
    description: "List sanitized durable workflow views for a workspace.",
    inputSchema: listWorkflowsInputSchema
  },
  agent_team_plan_consensus: {
    title: "Plan Agent Workflow Consensus",
    description:
      "Record and evaluate a provider-neutral planning consensus round for a durable workflow.",
    inputSchema: planConsensusInputSchema
  },
  agent_team_start_slices: {
    title: "Start Workflow Slices",
    description: "Start approved ready workflow slices with bounded concurrency.",
    inputSchema: startSlicesInputSchema
  },
  agent_team_unblock_slice: {
    title: "Unblock Workflow Slice",
    description: "Record dependency evidence and optionally notify waiting workflow slice runs.",
    inputSchema: unblockSliceInputSchema
  },
  agent_team_review_slice: {
    title: "Review Workflow Slice",
    description:
      "Record provider-neutral review consensus and sign-off evidence for one workflow slice.",
    inputSchema: reviewSliceInputSchema
  },
  agent_team_integration_queue: {
    title: "Build Workflow Integration Queue",
    description:
      "Build a read-only provider-neutral integration order and conflict-risk report for approved workflow slices.",
    inputSchema: integrationQueueInputSchema
  },
  agent_team_record_integration: {
    title: "Record Workflow Integration Evidence",
    description:
      "Record Codex-owned integration evidence and final verification results for a queued workflow slice.",
    inputSchema: recordIntegrationInputSchema
  },
  agent_team_workflow_report: {
    title: "Build Workflow Completion Report",
    description:
      "Read a provider-neutral workflow completion report without mutating state or claiming completion without final gate evidence.",
    inputSchema: workflowReportInputSchema
  },
  agent_team_workflow_next: {
    title: "Get Workflow Next Actions",
    description:
      "Read sanitized Superpowers-style next actions and hook guidance for a durable workflow without executing providers, mutating source, or exposing private instructions.",
    inputSchema: workflowNextInputSchema
  },
  agent_team_record_user_decision: {
    title: "Record Workflow User Decision",
    description:
      "Record a product-level workflow decision from the user and return the next sanitized hook guidance.",
    inputSchema: workflowUserDecisionInputSchema
  },
  agent_team_dashboard: {
    title: "Agent Team Dashboard",
    description:
      "Read-only compact dashboard and evidence report for exactly one source: a team or run list.",
    inputSchema: dashboardInputSchema
  },
  agent_team_cancel: {
    title: "Cancel Agent Session",
    description: "Request cancellation for an active or durable run.",
    inputSchema: statusInputSchema
  },
  agent_team_cancel_many: {
    title: "Cancel Agent Sessions",
    description: "Request cancellation for multiple active or durable runs with bounded concurrency.",
    inputSchema: cancelManyInputSchema
  },
  agent_team_wind_down: {
    title: "Wind Down Agent Session",
    description: "Request graceful finalization for an active or durable run.",
    inputSchema: statusInputSchema
  },
  agent_team_wind_down_many: {
    title: "Wind Down Agent Sessions",
    description: "Request graceful finalization for multiple active or durable runs with bounded concurrency.",
    inputSchema: windDownManyInputSchema
  },
  agent_team_cleanup: {
    title: "Cleanup Agent Workspace",
    description: "Explicitly remove a retained implementation worktree after review.",
    inputSchema: cleanupInputSchema
  },
  agent_team_doctor: {
    title: "Run Agent Team Doctor",
    description: "Check workspace readiness, provider health, and routing.",
    inputSchema: cwdOnlyInputSchema
  },
  agent_team_list_roles: {
    title: "List Agent Roles",
    description: "List provider-neutral roles and required capabilities.",
    inputSchema: z.object({})
  },
  agent_team_list_providers: {
    title: "List Agent Providers",
    description: "List configured providers and exposed capabilities.",
    inputSchema: cwdOnlyInputSchema
  }
} satisfies Record<ToolName, ToolMetadata>;
