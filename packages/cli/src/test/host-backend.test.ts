import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostExecutionBackend, resolveWorkspacePath } from "../tools/backends/host.js";

describe("HostExecutionBackend", () => {
  let tempDir: string;
  let demoPath: string;
  let demoContent: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "xpert-cli-backend-"));
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    demoPath = path.join(tempDir, "src", "demo.ts");
    demoContent = [
      "const demo = 1;",
      'const message = "before";',
      "console.log(message);",
      "",
    ].join("\n");
    await writeFile(demoPath, demoContent, "utf8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("blocks writes outside the project root", () => {
    expect(() => resolveWorkspacePath(tempDir, "../escape.txt", "write")).toThrow(
      "Path escapes project root",
    );
  });

  it("blocks writes inside .git", () => {
    expect(() => resolveWorkspacePath(tempDir, ".git/config", "write")).toThrow(
      "Writes to .git are not allowed",
    );
  });

  it("creates a new file with a diff", async () => {
    const backend = new HostExecutionBackend(tempDir);
    const result = await backend.writeFile({
      path: "src/new-file.ts",
      content: 'export const created = "yes";\n',
    });

    expect(result.path).toBe("src/new-file.ts");
    expect(result.diff).toContain("+export const created = \"yes\";");
    expect(await readFile(path.join(tempDir, "src", "new-file.ts"), "utf8")).toBe(
      'export const created = "yes";\n',
    );
  });

  it("fails to create a file when it already exists", async () => {
    const backend = new HostExecutionBackend(tempDir);

    await expect(
      backend.writeFile({
        path: "src/demo.ts",
        content: "const demo = 2;\n",
      }),
    ).rejects.toThrow("File already exists: src/demo.ts. Use Patch instead.");
  });

  it("rejects malformed write payloads before creating files", async () => {
    const backend = new HostExecutionBackend(tempDir);

    await expect(
      backend.writeFile({
        path: "src/invalid.ts",
        content: 123,
      } as unknown as { path: string; content: string }),
    ).rejects.toThrow("Write content must be a string");

    await expect(readFile(path.join(tempDir, "src", "invalid.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects writeFile paths outside the project root", async () => {
    const backend = new HostExecutionBackend(tempDir);

    await expect(
      backend.writeFile({
        path: "../escape.txt",
        content: "escape",
      }),
    ).rejects.toThrow("Path escapes project root");
  });

  it("applies an exact patch", async () => {
    const backend = new HostExecutionBackend(tempDir);
    const result = await backend.patchFile({
      path: "src/demo.ts",
      oldString: "const demo = 1;",
      newString: "const demo = 2;",
    });

    expect(result.mode).toBe("replace");
    expect(result.occurrences).toBe(1);
    expect(result.diff).toContain("+const demo = 2;");
    expect(await readFile(demoPath, "utf8")).toContain("const demo = 2;");
  });

  it("applies a range patch", async () => {
    const backend = new HostExecutionBackend(tempDir);
    const result = await backend.patchFile({
      kind: "range",
      path: "src/demo.ts",
      startLine: 2,
      endLine: 3,
      newContent: 'const message = "after";\nconsole.log(message.toUpperCase());',
    });

    expect(result.mode).toBe("range");
    expect(result.diff).toContain('+const message = "after";');
    expect(await readFile(demoPath, "utf8")).toBe(
      [
        "const demo = 1;",
        'const message = "after";',
        "console.log(message.toUpperCase());",
        "",
      ].join("\n"),
    );
  });

  it("applies a multi-edit patch sequentially", async () => {
    const backend = new HostExecutionBackend(tempDir);
    const result = await backend.patchFile({
      kind: "multi",
      path: "src/demo.ts",
      edits: [
        {
          oldString: "const demo = 1;",
          newString: "const demo = 2;",
        },
        {
          kind: "range",
          startLine: 2,
          endLine: 3,
          newContent: 'const message = "after";\nconsole.log(`${message}!`);',
        },
      ],
    });

    expect(result.mode).toBe("multi");
    expect(result.appliedEdits).toBe(2);
    expect(result.diff).toContain("+const demo = 2;");
    expect(result.diff).toContain('+const message = "after";');
    expect(await readFile(demoPath, "utf8")).toBe(
      [
        "const demo = 2;",
        'const message = "after";',
        "console.log(`${message}!`);",
        "",
      ].join("\n"),
    );
  });

  it("does not partially write when a multi-edit patch fails", async () => {
    const backend = new HostExecutionBackend(tempDir);

    await expect(
      backend.patchFile({
        kind: "multi",
        path: "src/demo.ts",
        edits: [
          {
            oldString: "const demo = 1;",
            newString: "const demo = 2;",
          },
          {
            oldString: "missing text",
            newString: "will fail",
          },
        ],
      }),
    ).rejects.toThrow("Patch context not found");

    expect(await readFile(demoPath, "utf8")).toBe(demoContent);
  });

  it("rejects malformed patch payloads before writing", async () => {
    const backend = new HostExecutionBackend(tempDir);

    await expect(
      backend.patchFile({
        path: "src/demo.ts",
        oldString: "const demo = 1;",
        newString: 2,
      } as unknown as Parameters<typeof backend.patchFile>[0]),
    ).rejects.toThrow("Patch newString must be a string");

    expect(await readFile(demoPath, "utf8")).toBe(demoContent);
  });

  it("aborts a running shell command when the turn is cancelled", async () => {
    const backend = new HostExecutionBackend(tempDir);
    const controller = new AbortController();

    const command = `${process.execPath} -e "setTimeout(() => {}, 5000)"`;
    const execution = backend.exec(command, {
      signal: controller.signal,
      timeoutMs: 10_000,
    });

    setTimeout(() => controller.abort(), 50);

    await expect(execution).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
