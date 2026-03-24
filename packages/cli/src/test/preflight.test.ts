import { describe, expect, it, vi } from "vitest";
import { normalizeSdkRequestError } from "../sdk/request-errors.js";
import {
  formatPreflightFailure,
  renderDoctorJson,
  renderDoctorReport,
  runCliPreflight,
} from "../runtime/preflight.js";

describe("CLI preflight", () => {
  it("reports assistant_not_found with explicit guidance", async () => {
    const getAssistant = vi.fn().mockRejectedValue(
      normalizeSdkRequestError(new Error("assistant not found"), {
        operation: "getAssistant",
        apiUrl: "http://localhost:3000/api/ai",
        url: "http://localhost:3000/api/ai/assistants/assistant-missing",
        method: "GET",
        preserveMessage: true,
      }),
    );

    const report = await runCliPreflight(createConfig(), {
      mode: "light",
      deps: {
        createClient: () => ({
          ensureThread: vi.fn(),
          getAssistant,
        }),
      },
    });

    const assistantCheck = report.checks.find((check) => check.id === "assistant");
    expect(report.ok).toBe(false);
    expect(assistantCheck).toMatchObject({
      status: "fail",
      message: "assistant not found",
    });
    expect(formatPreflightFailure(report)).toContain("assistant not found");
    expect(formatPreflightFailure(report)).toContain("hint: check XPERT_AGENT_ID");
    expect(formatPreflightFailure(report)).not.toContain("The requested record was not found");
  });

  it("produces full doctor checks when remote diagnostics succeed", async () => {
    const ensureThread = vi.fn().mockResolvedValue("thread-1");
    const getAssistant = vi.fn().mockResolvedValue({ id: "assistant-1" });

    const report = await runCliPreflight(createConfig(), {
      mode: "doctor",
      deps: {
        createClient: () => ({
          ensureThread,
          getAssistant,
        }),
      },
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "backend", status: "pass" }),
        expect.objectContaining({ id: "auth", status: "pass" }),
        expect.objectContaining({ id: "assistant", status: "pass" }),
        expect.objectContaining({ id: "organization", status: "pass" }),
        expect.objectContaining({ id: "thread_create", status: "pass" }),
      ]),
    );
  });

  it("renders doctor output with pass, warn, and fail states", () => {
    const report = {
      mode: "doctor" as const,
      ok: false,
      checks: [
        {
          id: "backend" as const,
          status: "pass" as const,
          message: "backend reachable",
          detail: "http://localhost:3000/api/ai",
          hints: [],
        },
        {
          id: "organization" as const,
          status: "warn" as const,
          message: "XPERT_ORGANIZATION_ID is not configured",
          hints: [],
        },
        {
          id: "assistant" as const,
          status: "fail" as const,
          message: "assistant not found",
          hints: ["check XPERT_AGENT_ID", "run xpert doctor"],
        },
      ],
      summary: {
        pass: 1,
        warn: 1,
        fail: 1,
      },
      metadata: {
        apiUrl: "http://localhost:3000/api/ai",
        assistantId: "assistant-1",
        cwd: "/tmp/project",
        projectRoot: "/tmp/project",
      },
    };

    const rendered = renderDoctorReport(report);

    expect(rendered).toContain("[pass] backend reachable");
    expect(rendered).toContain("[warn] XPERT_ORGANIZATION_ID is not configured");
    expect(rendered).toContain("[fail] assistant not found");
    expect(rendered).toContain("hint: check XPERT_AGENT_ID");
    expect(renderDoctorJson(report)).toBe(JSON.stringify(report, null, 2));
  });
});

function createConfig() {
  return {
    apiUrl: "http://localhost:3000/api/ai",
    apiKey: "test-key",
    assistantId: "assistant-1",
    defaultModel: undefined,
    organizationId: "org-1",
    approvalMode: "default" as const,
    sandboxMode: "host" as const,
    projectRoot: "/tmp/project",
    cwd: "/tmp/project",
    userConfigDir: "/tmp/.xpert-cli",
    userConfigPath: "/tmp/.xpert-cli/config.json",
    projectConfigPath: "/tmp/project/.xpert-cli.json",
    xpertMdPath: undefined,
    xpertMdContent: undefined,
  };
}
