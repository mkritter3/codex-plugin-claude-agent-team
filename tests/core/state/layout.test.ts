import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_TEAM_STATE_LAYOUT_VERSION,
  inspectStateLayout
} from "../../../src/core/state/layout.js";
import { stateLayoutPath } from "../../../src/core/state/paths.js";

describe("state layout inspection", () => {
  it("reports missing layout markers as compatible with initialization", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-layout-"));

    await expect(inspectStateLayout(workspace)).resolves.toEqual({
      status: "missing",
      currentVersion: AGENT_TEAM_STATE_LAYOUT_VERSION,
      path: stateLayoutPath(workspace),
      message: "State layout marker is missing; layout version 1 can be initialized."
    });
  });

  it("reports current layout markers as compatible", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-layout-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      stateLayoutPath(workspace),
      JSON.stringify({ layoutVersion: 1 }),
      "utf8"
    );

    await expect(inspectStateLayout(workspace)).resolves.toEqual({
      status: "compatible",
      currentVersion: AGENT_TEAM_STATE_LAYOUT_VERSION,
      observedVersion: 1,
      path: stateLayoutPath(workspace),
      message: "State layout version 1 is compatible."
    });
  });

  it("reports future layout markers as incompatible", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-layout-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      stateLayoutPath(workspace),
      JSON.stringify({ layoutVersion: 2 }),
      "utf8"
    );

    await expect(inspectStateLayout(workspace)).resolves.toEqual({
      status: "incompatible",
      currentVersion: AGENT_TEAM_STATE_LAYOUT_VERSION,
      observedVersion: 2,
      path: stateLayoutPath(workspace),
      message: "State layout version 2 is newer than supported version 1."
    });
  });

  it("reports malformed layout JSON as corrupt without throwing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-layout-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(stateLayoutPath(workspace), "{ nope", "utf8");

    await expect(inspectStateLayout(workspace)).resolves.toMatchObject({
      status: "corrupt",
      currentVersion: AGENT_TEAM_STATE_LAYOUT_VERSION,
      path: stateLayoutPath(workspace),
      message: expect.stringContaining("Invalid state layout JSON")
    });
  });

  it("reports invalid layout version shapes as corrupt without throwing", async () => {
    const invalidMarkers = [
      { layoutVersion: "1" },
      { layoutVersion: 0 },
      { layoutVersion: -1 },
      { layoutVersion: 1.5 },
      { version: 1 }
    ];

    for (const [index, marker] of invalidMarkers.entries()) {
      const workspace = await mkdtemp(join(tmpdir(), `agent-team-layout-${index}-`));
      await mkdir(join(workspace, ".agent-team"), { recursive: true });
      await writeFile(stateLayoutPath(workspace), JSON.stringify(marker), "utf8");

      await expect(inspectStateLayout(workspace)).resolves.toMatchObject({
        status: "corrupt",
        currentVersion: AGENT_TEAM_STATE_LAYOUT_VERSION,
        path: stateLayoutPath(workspace),
        message: "state-layout.json layoutVersion must be a positive integer."
      });
    }
  });
});
