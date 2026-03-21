import type { CliSessionState } from "../runtime/session-store.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionManager } from "../permissions/manager.js";

const { promptForPermissionMock } = vi.hoisted(() => ({
  promptForPermissionMock: vi.fn(),
}));

vi.mock("../ui/permission.js", () => ({
  promptForPermission: promptForPermissionMock,
}));

describe("PermissionManager", () => {
  beforeEach(() => {
    promptForPermissionMock.mockReset();
  });

  it("remembers Patch approvals by normalized target path", async () => {
    const session = createSession();
    promptForPermissionMock.mockResolvedValueOnce({ outcome: "allow_session" });
    const manager = new PermissionManager({
      session,
      approvalMode: "default",
      interactive: true,
    });

    const first = await manager.request("Patch", {
      path: "./src/../src/demo.ts",
      oldString: "a",
      newString: "b",
    });
    const second = await manager.request("Patch", {
      path: "src/demo.ts",
      oldString: "x",
      newString: "y",
    });

    expect(first).toMatchObject({
      allowed: true,
      remembered: true,
      outcome: "allow_session",
    });
    expect(second).toMatchObject({
      allowed: true,
      remembered: true,
      outcome: "remembered_allow",
      scope: "Patch src/demo.ts",
    });
    expect(promptForPermissionMock).toHaveBeenCalledTimes(1);
    expect(session.approvals[0]).toMatchObject({
      toolName: "Patch",
      decision: "allow",
      scopeType: "path",
      path: "src/demo.ts",
    });
  });

  it("does not session-remember dangerous bash allows", async () => {
    const session = createSession();
    promptForPermissionMock.mockResolvedValue({ outcome: "allow_once" });
    const manager = new PermissionManager({
      session,
      approvalMode: "default",
      interactive: true,
    });

    const first = await manager.request("Bash", {
      command: "sudo rm -rf build",
      cwd: "./",
    });
    const second = await manager.request("Bash", {
      command: "sudo   rm   -rf   build",
      cwd: ".",
    });

    expect(first).toMatchObject({
      allowed: true,
      outcome: "allow_once",
      riskLevel: "dangerous",
    });
    expect(second).toMatchObject({
      allowed: true,
      outcome: "allow_once",
      riskLevel: "dangerous",
    });
    expect(promptForPermissionMock).toHaveBeenCalledTimes(2);
    expect(session.approvals).toHaveLength(0);
  });

  it("remembers moderate bash denies by normalized command and cwd", async () => {
    const session = createSession();
    promptForPermissionMock.mockResolvedValueOnce({ outcome: "deny_session" });
    const manager = new PermissionManager({
      session,
      approvalMode: "default",
      interactive: true,
    });

    const first = await manager.request("Bash", {
      command: "pnpm   test",
      cwd: "./",
      timeoutMs: 1_000,
    });
    const second = await manager.request("Bash", {
      command: "pnpm test",
      cwd: ".",
      timeoutMs: 10_000,
    });

    expect(first).toMatchObject({
      allowed: false,
      remembered: true,
      outcome: "deny_session",
    });
    expect(second).toMatchObject({
      allowed: false,
      remembered: true,
      outcome: "remembered_deny",
      scope: "Bash pnpm test @ .",
    });
    expect(promptForPermissionMock).toHaveBeenCalledTimes(1);
    expect(session.approvals[0]).toMatchObject({
      toolName: "Bash",
      decision: "deny",
      scopeType: "command",
      cwd: ".",
      command: "pnpm test",
    });
  });

  it("uses the session cwd for bash scope when args.cwd is omitted", async () => {
    const session = createSession();
    session.cwd = "/tmp/project/packages/api";
    promptForPermissionMock.mockResolvedValueOnce({ outcome: "deny_session" });
    promptForPermissionMock.mockResolvedValueOnce({ outcome: "deny_once" });
    const manager = new PermissionManager({
      session,
      approvalMode: "default",
      interactive: true,
    });

    const first = await manager.request("Bash", {
      command: "pnpm test",
    });

    session.cwd = "/tmp/project/packages/web";

    const second = await manager.request("Bash", {
      command: "pnpm test",
    });

    expect(first).toMatchObject({
      allowed: false,
      remembered: true,
      outcome: "deny_session",
      scope: "Bash pnpm test @ packages/api",
    });
    expect(second).toMatchObject({
      allowed: false,
      outcome: "deny_once",
      scope: "Bash pnpm test @ packages/web",
    });
    expect(promptForPermissionMock).toHaveBeenCalledTimes(2);
  });

  it("matches legacy approvals even when argument key order differs", async () => {
    const session = createSession();
    session.approvals.push({
      toolName: "Bash",
      decision: "deny",
      riskLevel: "moderate",
      scopeType: "legacy",
      legacyKey: 'Bash:{"cwd":"src","command":"pnpm test"}',
      createdAt: new Date().toISOString(),
    });
    const manager = new PermissionManager({
      session,
      approvalMode: "default",
      interactive: true,
    });

    const decision = await manager.request("Bash", {
      command: "pnpm test",
      cwd: "src",
    });

    expect(decision).toMatchObject({
      allowed: false,
      remembered: true,
      outcome: "remembered_deny",
    });
    expect(promptForPermissionMock).not.toHaveBeenCalled();
  });
});

function createSession(): CliSessionState {
  const now = new Date().toISOString();
  return {
    sessionId: "session-1",
    assistantId: "assistant-1",
    cwd: "/tmp/project",
    projectRoot: "/tmp/project",
    recentFiles: [],
    recentToolCalls: [],
    approvals: [],
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}
