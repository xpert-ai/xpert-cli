import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../tools/contracts.js";
import { patchTool } from "../tools/patch.js";

describe("patchTool", () => {
  it("returns changed files for multi-edit patches", async () => {
    const patchFile = vi.fn().mockResolvedValue({
      path: "src/demo.ts",
      diff: "--- src/demo.ts\n+++ src/demo.ts\n+const demo = 2;\n",
      mode: "multi",
      occurrences: 1,
      appliedEdits: 2,
    });

    const context = {
      backend: { patchFile },
    } as unknown as ToolExecutionContext;

    const result = await patchTool.execute(
      {
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
            endLine: 2,
            newContent: 'const message = "after";',
          },
        ],
      },
      context,
    );

    expect(patchFile).toHaveBeenCalledWith({
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
          endLine: 2,
          newContent: 'const message = "after";',
        },
      ],
    });
    expect(result.changedFiles).toEqual(["src/demo.ts"]);
    expect(result.content).toBe("Patched src/demo.ts. Applied 2 edits.");
  });
});
