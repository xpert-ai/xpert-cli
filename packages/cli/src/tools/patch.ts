import { summarizeDiff } from "../ui/diff.js";
import type { PatchFileArgs, ToolDefinition } from "./contracts.js";

const replaceEditSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["replace"] },
    oldString: { type: "string" },
    newString: { type: "string" },
    replaceAll: { type: "boolean" },
  },
  required: ["oldString", "newString"],
};

const rangeEditSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["range"] },
    startLine: { type: "number", minimum: 1 },
    endLine: { type: "number", minimum: 1 },
    newContent: { type: "string" },
  },
  required: ["kind", "startLine", "endLine", "newContent"],
};

export const patchTool: ToolDefinition<PatchFileArgs> = {
  name: "Patch",
  description:
    "Patch an existing file in the local project using exact replace, line-range replace, or multi-edit sequences.",
  schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["replace", "range", "multi"] },
      path: { type: "string", description: "Path relative to the project root." },
      oldString: { type: "string" },
      newString: { type: "string" },
      replaceAll: { type: "boolean" },
      startLine: { type: "number", minimum: 1 },
      endLine: { type: "number", minimum: 1 },
      newContent: { type: "string" },
      edits: {
        type: "array",
        minItems: 1,
        items: {
          anyOf: [replaceEditSchema, rangeEditSchema],
        },
      },
    },
    required: ["path"],
    anyOf: [
      {
        required: ["path", "oldString", "newString"],
      },
      {
        required: ["kind", "path", "startLine", "endLine", "newContent"],
        properties: {
          kind: { type: "string", enum: ["range"] },
        },
      },
      {
        required: ["kind", "path", "edits"],
        properties: {
          kind: { type: "string", enum: ["multi"] },
        },
      },
    ],
  },
  async execute(args, context) {
    const result = await context.backend.patchFile(args);
    return {
      summary: `${result.path} ${summarizeDiff(result.diff)}`,
      content: describePatchResult(result),
      artifact: {
        diff: result.diff,
        mode: result.mode,
        occurrences: result.occurrences,
        appliedEdits: result.appliedEdits,
      },
      changedFiles: [result.path],
    };
  },
};

function describePatchResult(result: {
  path: string;
  mode: "replace" | "range" | "multi";
  occurrences: number;
  appliedEdits: number;
}): string {
  switch (result.mode) {
    case "replace":
      return `Patched ${result.path}. Replacements: ${result.occurrences}.`;
    case "range":
      return `Patched ${result.path}. Applied 1 range edit.`;
    case "multi":
      return `Patched ${result.path}. Applied ${result.appliedEdits} edits.`;
  }
}
