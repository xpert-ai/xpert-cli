import type { ToolCallSummary } from "@xpert-cli/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  RUN_LOCAL_CONTEXT_LIMITS,
  buildRunLocalContext,
  getGitStatusSnapshot,
  renderLocalContextBlock,
  renderPromptWithLocalContext,
} from "../context/run-context.js";

describe("run local context", () => {
  it("truncates XPERT.md content when building local context", async () => {
    const lines = Array.from(
      { length: RUN_LOCAL_CONTEXT_LIMITS.xpertMdLines + 12 },
      (_, index) => `rule ${index + 1}`,
    ).join("\n");

    const localContext = await buildRunLocalContext({
      config: createConfig(),
      session: createSession(),
      deps: {
        loadXpertMd: vi.fn().mockResolvedValue({
          path: "/tmp/project/XPERT.md",
          content: lines,
        }),
        getGitStatus: vi.fn().mockResolvedValue({
          available: true,
          isRepo: true,
          statusShort: "M src/index.ts",
          truncated: false,
        }),
      },
    });

    expect(localContext.xpertMd.available).toBe(true);
    expect(localContext.xpertMd.truncated).toBe(true);
    expect(localContext.xpertMd.content).toContain("rule 1");
    expect(localContext.xpertMd.content).not.toContain(
      `rule ${RUN_LOCAL_CONTEXT_LIMITS.xpertMdLines + 1}`,
    );
  });

  it("gracefully reports unavailable git when the executable is missing", async () => {
    const git = await getGitStatusSnapshot({
      projectRoot: "/tmp/project",
      runCommand: vi.fn().mockRejectedValue(
        Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }),
      ),
    });

    expect(git).toEqual({
      available: false,
      isRepo: false,
      truncated: false,
      reason: "git executable unavailable",
    });
  });

  it("gracefully reports a non-git directory", async () => {
    const git = await getGitStatusSnapshot({
      projectRoot: "/tmp/project",
      runCommand: vi.fn().mockRejectedValue(
        Object.assign(new Error("fatal: not a git repository"), {
          stderr: "fatal: not a git repository (or any of the parent directories): .git",
        }),
      ),
    });

    expect(git).toEqual({
      available: true,
      isRepo: false,
      truncated: false,
      reason: "not a git repository",
    });
  });

  it("clips recent files and recent tool calls", async () => {
    const recentFiles = Array.from(
      { length: RUN_LOCAL_CONTEXT_LIMITS.recentFiles + 4 },
      (_, index) => `packages/file-${index}.ts`,
    );
    const recentToolCalls = Array.from(
      { length: RUN_LOCAL_CONTEXT_LIMITS.recentToolCalls + 5 },
      (_, index) =>
        createToolSummary({
          id: `call-${index}`,
          summary: `summary-${index} ${"x".repeat(RUN_LOCAL_CONTEXT_LIMITS.toolSummaryChars)}`,
        }),
    );

    const localContext = await buildRunLocalContext({
      config: createConfig(),
      session: createSession({
        recentFiles,
        recentToolCalls,
      }),
      deps: {
        loadXpertMd: vi.fn().mockResolvedValue({}),
        getGitStatus: vi.fn().mockResolvedValue({
          available: true,
          isRepo: true,
          statusShort: "",
          truncated: false,
        }),
      },
    });

    expect(localContext.workingSet.recentFiles).toHaveLength(
      RUN_LOCAL_CONTEXT_LIMITS.recentFiles,
    );
    expect(localContext.workingSet.recentToolCalls).toHaveLength(
      RUN_LOCAL_CONTEXT_LIMITS.recentToolCalls,
    );
    expect(localContext.workingSet.recentToolCalls[0]?.summary.length).toBeLessThanOrEqual(
      RUN_LOCAL_CONTEXT_LIMITS.toolSummaryChars,
    );
  });

  it("renders a prompt envelope with the local context block", async () => {
    const localContext = await buildRunLocalContext({
      config: createConfig(),
      session: createSession({
        recentFiles: ["packages/cli/src/sdk/client.ts"],
        recentToolCalls: [createToolSummary({ summary: "Read sdk/client.ts" })],
      }),
      deps: {
        loadXpertMd: vi.fn().mockResolvedValue({
          path: "/tmp/project/XPERT.md",
          content: "Stay inside xpert-cli.",
        }),
        getGitStatus: vi.fn().mockResolvedValue({
          available: true,
          isRepo: true,
          statusShort: "M packages/cli/src/sdk/client.ts",
          truncated: false,
        }),
      },
    });

    const block = renderLocalContextBlock(localContext);
    const prompt = renderPromptWithLocalContext("Fix the request wiring.", localContext);

    expect(block).toContain("[Local Context]");
    expect(block).toContain("Project root: /tmp/project");
    expect(block).toContain("Recent changed files:");
    expect(prompt).toContain("[/Local Context]\n\nUser request:\nFix the request wiring.");
  });

  it("prefers the resumed session cwd and project root over the caller runtime config", async () => {
    const loadXpertMdMock = vi.fn().mockResolvedValue({
      path: "/tmp/other-project/XPERT.md",
      content: "Stay inside the resumed project.",
    });
    const getGitStatusMock = vi.fn().mockResolvedValue({
      available: true,
      isRepo: true,
      statusShort: "M packages/api/src/index.ts",
      truncated: false,
    });

    const localContext = await buildRunLocalContext({
      config: createConfig(),
      session: createSession({
        projectRoot: "/tmp/other-project",
        cwd: "/tmp/other-project/packages/api",
      }),
      deps: {
        loadXpertMd: loadXpertMdMock,
        getGitStatus: getGitStatusMock,
      },
    });

    expect(loadXpertMdMock).toHaveBeenCalledWith("/tmp/other-project");
    expect(getGitStatusMock).toHaveBeenCalledWith({
      projectRoot: "/tmp/other-project",
      signal: undefined,
    });
    expect(localContext.projectRoot).toBe("/tmp/other-project");
    expect(localContext.cwd).toBe("/tmp/other-project/packages/api");
  });

  it("preserves recent files and recent tool calls in the rendered block when other sections are large", async () => {
    const longXpertMd = Array.from({ length: 120 }, (_, index) => `rule ${index + 1}`).join("\n");
    const longGitStatus = Array.from({ length: 120 }, (_, index) => `M file-${index}.ts`).join("\n");

    const localContext = await buildRunLocalContext({
      config: createConfig(),
      session: createSession({
        recentFiles: ["packages/cli/src/tools/write.ts"],
        recentToolCalls: [createToolSummary({ summary: "Patch src/demo.ts" })],
      }),
      deps: {
        loadXpertMd: vi.fn().mockResolvedValue({
          path: "/tmp/project/XPERT.md",
          content: longXpertMd,
        }),
        getGitStatus: vi.fn().mockResolvedValue({
          available: true,
          isRepo: true,
          statusShort: longGitStatus,
          truncated: true,
        }),
      },
    });

    const block = renderLocalContextBlock(localContext);

    expect(block).toContain("Recent changed files:");
    expect(block).toContain("packages/cli/src/tools/write.ts");
    expect(block).toContain("Recent tool calls:");
    expect(block).toContain("Patch src/demo.ts");
  });
});

function createConfig() {
  return {
    cwd: "/tmp/project",
    projectRoot: "/tmp/project",
  };
}

function createSession(
  overrides?: Partial<{
    cwd: string;
    projectRoot: string;
    recentFiles: string[];
    recentToolCalls: ToolCallSummary[];
  }>,
) {
  return {
    cwd: overrides?.cwd ?? "/tmp/project",
    projectRoot: overrides?.projectRoot ?? "/tmp/project",
    recentFiles: overrides?.recentFiles ?? [],
    recentToolCalls: overrides?.recentToolCalls ?? [],
  };
}

function createToolSummary(overrides?: Partial<ToolCallSummary>): ToolCallSummary {
  return {
    id: overrides?.id ?? "call-1",
    toolName: overrides?.toolName ?? "Read",
    summary: overrides?.summary ?? "read src/index.ts",
    status: overrides?.status ?? "success",
    createdAt: overrides?.createdAt ?? "2026-03-21T00:00:00.000Z",
  };
}
