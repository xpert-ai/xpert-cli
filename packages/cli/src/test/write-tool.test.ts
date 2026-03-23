import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../tools/contracts.js";
import { writeTool } from "../tools/write.js";

describe("writeTool", () => {
  it("prints the diff and records the created file", async () => {
    const showDiff = vi.fn();
    const writeFile = vi.fn().mockResolvedValue({
      path: "src/new-file.ts",
      diff: "--- src/new-file.ts\n+++ src/new-file.ts\n+export const created = true;\n",
    });

    const context = {
      backend: { writeFile },
      ui: { showDiff },
    } as unknown as ToolExecutionContext;

    const result = await writeTool.execute(
      {
        path: "src/new-file.ts",
        content: "export const created = true;\n",
      },
      context,
    );

    expect(writeFile).toHaveBeenCalledWith({
      path: "src/new-file.ts",
      content: "export const created = true;\n",
    });
    expect(showDiff).toHaveBeenCalledWith(expect.stringContaining("+export const created = true;"));
    expect(result.changedFiles).toEqual(["src/new-file.ts"]);
    expect(result.summary).toContain("src/new-file.ts");
  });
});
