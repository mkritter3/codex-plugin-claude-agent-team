import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendBoundedLog } from "../../src/core/logs.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-logs-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("appendBoundedLog", () => {
  it("creates parent directories and appends text", async () => {
    const path = join(workspace, ".agent-team", "logs", "run.log");

    await appendBoundedLog(path, "first\n", { maxBytes: 100, maxRotatedFiles: 2 });
    await appendBoundedLog(path, "second\n", { maxBytes: 100, maxRotatedFiles: 2 });

    await expect(readFile(path, "utf8")).resolves.toBe("first\nsecond\n");
  });

  it("rotates before an append would exceed the byte budget", async () => {
    const path = join(workspace, "run.log");

    await appendBoundedLog(path, "12345", { maxBytes: 8, maxRotatedFiles: 2 });
    await appendBoundedLog(path, "6789", { maxBytes: 8, maxRotatedFiles: 2 });

    await expect(readFile(`${path}.1`, "utf8")).resolves.toBe("12345");
    await expect(readFile(path, "utf8")).resolves.toBe("6789");
    expect((await stat(path)).size).toBeLessThanOrEqual(8);
  });

  it("keeps only the configured number of rotated files", async () => {
    const path = join(workspace, "run.log");

    await appendBoundedLog(path, "one", { maxBytes: 3, maxRotatedFiles: 2 });
    await appendBoundedLog(path, "two", { maxBytes: 3, maxRotatedFiles: 2 });
    await appendBoundedLog(path, "three", { maxBytes: 3, maxRotatedFiles: 2 });
    await appendBoundedLog(path, "four", { maxBytes: 3, maxRotatedFiles: 2 });

    await expect(readFile(path, "utf8")).resolves.toBe("our");
    await expect(readFile(`${path}.1`, "utf8")).resolves.toBe("ree");
    await expect(readFile(`${path}.2`, "utf8")).resolves.toBe("two");
    await expect(stat(`${path}.3`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
