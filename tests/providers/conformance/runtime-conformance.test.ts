import { describeProviderRuntimeConformance } from "./runtime-conformance.js";
import type { AgentProviderRuntime } from "../../../src/providers/runtime.js";
import type {
  ProviderSessionDoneStatus,
  ProviderSessionHandle,
  ProviderSessionSnapshot
} from "../../../src/providers/types.js";

function resolvedHandle(input: {
  readonly providerSessionId?: string;
  readonly doneStatus?: ProviderSessionDoneStatus;
}): ProviderSessionHandle & { readonly killed: () => boolean; readonly forceKilled: () => boolean } {
  let killed = false;
  let forceKilled = false;
  const snapshot = (): ProviderSessionSnapshot => ({
    providerSessionId: input.providerSessionId,
    text: "fixture transcript text",
    warnings: [],
    recentActivities: [
      { type: "text", summary: "Fixture activity", timestamp: 1 }
    ],
    currentActivity: null,
    pendingOutboxRequests: [],
    lastStderr: [],
    transcriptPath: "/tmp/fixture-transcript.jsonl",
    logPath: "/tmp/fixture.log"
  });

  return {
    providerSessionId: input.providerSessionId,
    done: Promise.resolve(input.doneStatus ?? "completed"),
    recentActivities: snapshot().recentActivities,
    currentActivity: null,
    lastStderr: [],
    transcriptPath: "/tmp/fixture-transcript.jsonl",
    logPath: "/tmp/fixture.log",
    supportsStdin: true,
    kill() {
      killed = true;
    },
    forceKill() {
      forceKilled = true;
    },
    writeStdin(data: string) {
      return data.length > 0;
    },
    snapshot,
    killed: () => killed,
    forceKilled: () => forceKilled
  };
}

const fixtureRuntime: AgentProviderRuntime = {
  id: "fixture-runtime",
  descriptor: () => ({
    id: "fixture-runtime",
    displayName: "Fixture Runtime",
    authMode: "oauth",
    capabilities: ["structuredOutput", "tools", "sessionResume", "cancellation"],
    available: true,
    model: "fixture-model"
  }),
  inspectEnvironment(input) {
    return {
      warnings:
        input.env.FIXTURE_API_KEY === undefined
          ? []
          : ["Fixture API key is explicitly configured for this fixture."]
    };
  },
  async runPrint(input) {
    return {
      ok: true,
      sessionId: input.roleId === undefined ? "session_fixture" : `session_${input.roleId}`,
      text: `Fixture text for ${input.cwd}.`,
      stdout: JSON.stringify({ session_id: "session_fixture", result: "ok" }),
      stderr: "",
      exitCode: 0
    };
  },
  startSession(input) {
    return resolvedHandle({
      providerSessionId: input.sessionId ?? `session_${input.runId}`,
      doneStatus: "completed"
    });
  },
  async healthCheck(input) {
    const path = await input.findExecutable("fixture");
    if (path === undefined) {
      return [
        {
          id: "fixture-cli",
          status: "fail",
          message: "Fixture executable missing.",
          details: { fix: "Install fixture CLI." }
        }
      ];
    }

    const version = await input.getVersion(path);
    const auth = await input.runCommand(path, ["auth", "status"], { env: input.env });
    return [
      {
        id: "fixture-cli",
        status: "pass",
        message: "Fixture executable found.",
        details: { path, version }
      },
      {
        id: "fixture-auth",
        status: auth.ok ? "pass" : "fail",
        message: auth.ok ? "Fixture auth ok." : "Fixture auth failed.",
        details: { exitCode: auth.exitCode }
      }
    ];
  }
};

describeProviderRuntimeConformance({
  name: "fixture runtime",
  runtime: fixtureRuntime,
  descriptor: fixtureRuntime.descriptor(),
  sampleCwd: "/tmp/fixture-cwd",
  sampleWorkspaceRoot: "/tmp/fixture-workspace",
  supportedRoleId: "planner",
  unsupportedRoleId: "slice-implementer"
});
