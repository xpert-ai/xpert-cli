import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostExecutionBackend, resolveWorkspacePath } from "../tools/backends/host.js";

describe("HostExecutionBackend", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "xpert-cli-backend-"));
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "demo.ts"), "const demo = 1;\n", "utf8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("blocks writes outside the project root", () => {
    expect(() => resolveWorkspacePath(tempDir, "../escape.txt", "write")).toThrow(
      "Path escapes project root",
    );
  });

  it("applies an exact patch", async () => {
    const backend = new HostExecutionBackend(tempDir);
    const result = await backend.patchFile({
      path: "src/demo.ts",
      oldString: "const demo = 1;",
      newString: "const demo = 2;",
    });

    expect(result.occurrences).toBe(1);
    expect(result.diff).toContain("+const demo = 2;");
    expect(await readFile(path.join(tempDir, "src", "demo.ts"), "utf8")).toContain(
      "const demo = 2;",
    );
  });
});
