import { describe, expect, it } from "vitest";
import { ProviderCapabilityError } from "../../../src/core/errors.js";
import { selectProvider } from "../../../src/core/router.js";
import {
  PROVIDER_CAPABILITIES,
  type AgentProviderDescriptor,
  type ProviderAuthMode,
  type RoleId
} from "../../../src/core/types.js";
import type { AgentProviderRuntime } from "../../../src/providers/runtime.js";
import type {
  ProviderHealthCheckStatus,
  ProviderSessionDoneStatus
} from "../../../src/providers/types.js";

export interface ProviderRuntimeConformanceFixture {
  readonly name: string;
  readonly runtime: AgentProviderRuntime;
  readonly descriptor: AgentProviderDescriptor;
  readonly unsupportedRoleId?: RoleId;
  readonly supportedRoleId?: RoleId;
  readonly sampleCwd: string;
  readonly sampleWorkspaceRoot: string;
}

const VALID_AUTH_MODES = new Set<ProviderAuthMode>([
  "subscription-oauth",
  "api-key",
  "oauth",
  "none"
]);
const VALID_HEALTH_STATUSES = new Set<ProviderHealthCheckStatus>([
  "pass",
  "warn",
  "fail"
]);
const VALID_DONE_STATUSES = new Set<ProviderSessionDoneStatus>([
  "completed",
  "failed",
  "interrupted",
  "expired"
]);
const VALID_CAPABILITIES = new Set<string>(PROVIDER_CAPABILITIES);

function expectNonEmptyString(value: unknown): void {
  expect(typeof value).toBe("string");
  expect((value as string).trim().length).toBeGreaterThan(0);
}

export function describeProviderRuntimeConformance(
  fixture: ProviderRuntimeConformanceFixture
): void {
  describe(`${fixture.name} provider runtime conformance`, () => {
    it("exposes a conservative descriptor with valid capabilities", () => {
      const descriptor = fixture.runtime.descriptor();

      expect(descriptor.id).toBe(fixture.runtime.id);
      expect(descriptor.id).toBe(fixture.descriptor.id);
      expectNonEmptyString(descriptor.displayName);
      expect(VALID_AUTH_MODES.has(descriptor.authMode)).toBe(true);
      expect(typeof descriptor.available).toBe("boolean");
      expect(descriptor.capabilities.length).toBeGreaterThan(0);
      expect(new Set(descriptor.capabilities).size).toBe(descriptor.capabilities.length);
      for (const capability of descriptor.capabilities) {
        expect(VALID_CAPABILITIES.has(capability)).toBe(true);
      }
    });

    it("keeps routing fail-closed for unsupported capabilities", () => {
      expect(() =>
        selectProvider({
          roleId: fixture.unsupportedRoleId ?? "slice-implementer",
          providers: [fixture.descriptor]
        })
      ).toThrow(ProviderCapabilityError);
    });

    it("can satisfy a supported role without bypassing router validation", () => {
      const selected = selectProvider({
        roleId: fixture.supportedRoleId ?? "planner",
        providers: [fixture.descriptor]
      });

      expect(selected.id).toBe(fixture.descriptor.id);
    });

    it("returns provider-owned health checks with stable public shape", async () => {
      const checks = await fixture.runtime.healthCheck({
        workspaceRoot: fixture.sampleWorkspaceRoot,
        env: {},
        findExecutable: async (name) => `/usr/local/bin/${name}`,
        getVersion: async () => "1.0.0",
        runCommand: async () => ({
          ok: true,
          stdout: "ok",
          stderr: "",
          exitCode: 0
        })
      });

      expect(checks.length).toBeGreaterThan(0);
      for (const check of checks) {
        expectNonEmptyString(check.id);
        expect(VALID_HEALTH_STATUSES.has(check.status)).toBe(true);
        expectNonEmptyString(check.message);
        if (check.details !== undefined) {
          expect(typeof check.details).toBe("object");
          expect(Array.isArray(check.details)).toBe(false);
        }
      }
    });

    it("reports environment warnings as strings without inferring fallback", () => {
      const inspection = fixture.runtime.inspectEnvironment({
        authMode: fixture.descriptor.authMode,
        env: { FIXTURE_API_KEY: "explicit" }
      });

      expect(Array.isArray(inspection.warnings)).toBe(true);
      for (const warning of inspection.warnings) {
        expectNonEmptyString(warning);
      }
    });

    it("returns structured print results without making quality claims", async () => {
      const result = await fixture.runtime.runPrint({
        prompt: "Return a fixture response.",
        cwd: fixture.sampleCwd,
        roleId: fixture.supportedRoleId ?? "planner",
        executionPolicy: "read-only",
        env: {}
      });

      expect(typeof result.ok).toBe("boolean");
      expect(typeof result.text).toBe("string");
      expect(typeof result.stdout).toBe("string");
      expect(typeof result.stderr).toBe("string");
      expect(typeof result.exitCode).toBe("number");
      if (result.sessionId !== undefined) {
        expectNonEmptyString(result.sessionId);
      }
    });

    it("starts resumable sessions with inspectable handles and cancellation hooks", async () => {
      const handle = fixture.runtime.startSession({
        prompt: "Run a fixture session.",
        cwd: fixture.sampleCwd,
        workspaceRoot: fixture.sampleWorkspaceRoot,
        runId: "run_conformance",
        roleId: fixture.supportedRoleId ?? "planner",
        executionPolicy: "read-only",
        env: {},
        sessionId: "session_parent"
      });

      expect(handle.providerSessionId).toBe("session_parent");
      expect(typeof handle.supportsStdin).toBe("boolean");
      expect(Array.isArray(handle.recentActivities)).toBe(true);
      expect(Array.isArray(handle.lastStderr)).toBe(true);
      expect(typeof handle.kill).toBe("function");
      expect(typeof handle.forceKill).toBe("function");
      handle.kill();
      handle.forceKill();
      if (handle.writeStdin !== undefined) {
        expect(typeof handle.writeStdin("hello\n")).toBe("boolean");
      }

      const snapshot = handle.snapshot();
      expect(snapshot.providerSessionId).toBe("session_parent");
      expect(typeof snapshot.text).toBe("string");
      expect(Array.isArray(snapshot.warnings)).toBe(true);
      expect(Array.isArray(snapshot.recentActivities)).toBe(true);
      expect(Array.isArray(snapshot.pendingOutboxRequests)).toBe(true);
      expect(Array.isArray(snapshot.lastStderr)).toBe(true);
      expect(
        snapshot.transcriptPath === undefined || typeof snapshot.transcriptPath === "string"
      ).toBe(true);
      expect(snapshot.logPath === undefined || typeof snapshot.logPath === "string").toBe(true);
      for (const activity of snapshot.recentActivities) {
        expect(["tool_start", "text", "result", "error"]).toContain(activity.type);
        expectNonEmptyString(activity.summary);
        expect(typeof activity.timestamp).toBe("number");
      }

      expect(VALID_DONE_STATUSES.has(await handle.done)).toBe(true);
    });
  });
}
