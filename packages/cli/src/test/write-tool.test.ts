import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../tools/contracts.js";
import { writeTool } from "../tools/write.js";

describe("writeTool", () => {
  it("returns the created file and diff summary", async () => {
    const writeFile = vi.fn().mockResolvedValue({
      path: "src/new-file.ts",
      diff: "--- src/new-file.ts\n+++ src/new-file.ts\n+export const created = true;\n",
    });

    const context = {
      backend: { writeFile },
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
    expect(result.changedFiles).toEqual(["src/new-file.ts"]);
    expect(result.summary).toContain("src/new-file.ts");
  });
});
