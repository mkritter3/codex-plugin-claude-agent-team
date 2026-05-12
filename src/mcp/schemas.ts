import { z } from "zod";
import type { ToolName } from "./tools.js";

const role = z
  .enum([
    "architect",
    "planner",
    "code-reviewer",
    "debugger",
    "test-designer",
    "slice-implementer",
    "ux-product-critic"
  ])
  .describe("Agent role to run.");

const cwd = z.string().min(1).optional().describe("Workspace root. Defaults to server cwd.");
const provider = z.string().min(1).optional().describe("Preferred provider id.");
const timeoutMs = z.number().positive().optional().describe("Positive timeout in milliseconds.");
const runId = z.string().min(1).describe("Agent Team run id.");
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

const cleanupInputSchema = {
  runId,
  cwd,
  force
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
  agent_team_cancel: {
    title: "Cancel Agent Session",
    description: "Request cancellation for an active or durable run.",
    inputSchema: statusInputSchema
  },
  agent_team_wind_down: {
    title: "Wind Down Agent Session",
    description: "Request graceful finalization for an active or durable run.",
    inputSchema: statusInputSchema
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
    inputSchema: z.object({})
  }
} satisfies Record<ToolName, ToolMetadata>;
