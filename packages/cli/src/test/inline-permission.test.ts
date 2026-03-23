import { describe, expect, it } from "vitest";
import { InlinePermissionController } from "../ui/inline-permission.js";

describe("InlinePermissionController", () => {
  it("resolves the selected permission choice and clears state", async () => {
    const controller = new InlinePermissionController();
    const snapshots: Array<ReturnType<InlinePermissionController["getState"]>> = [];
    const unsubscribe = controller.subscribe((state) => {
      snapshots.push(state);
    });

    const pending = controller.request({
      toolName: "Patch",
      riskLevel: "moderate",
      reason: "modify src/app.ts",
      target: "src/app.ts",
      scope: "Patch src/app.ts",
      canRememberAllow: true,
      canRememberDeny: true,
    });

    expect(controller.getState()).toMatchObject({
      message: "Patch wants to run on src/app.ts (modify src/app.ts) [scope: Patch src/app.ts]",
      selectedIndex: 0,
    });
    expect(controller.getState()?.choices.map((choice) => choice.title)).toEqual([
      "Allow once",
      "Allow for session",
      "Deny once",
      "Deny for session",
    ]);

    controller.moveSelection(1);
    controller.submitSelection();

    await expect(pending).resolves.toEqual({ outcome: "allow_session" });
    expect(controller.getState()).toBeNull();
    expect(snapshots.at(-1)).toBeNull();

    unsubscribe();
  });

  it("rejects when the current turn is aborted", async () => {
    const controller = new InlinePermissionController();
    const abortController = new AbortController();

    const pending = controller.request(
      {
        toolName: "Bash",
        riskLevel: "dangerous",
        reason: "run pnpm test",
        target: "pnpm test",
        scope: "Bash pnpm test @ .",
        canRememberAllow: false,
        canRememberDeny: true,
      },
      abortController.signal,
    );

    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(controller.getState()).toBeNull();
  });

  it("denies the current permission request when the prompt is explicitly dismissed", async () => {
    const controller = new InlinePermissionController();

    const pending = controller.request({
      toolName: "Patch",
      riskLevel: "moderate",
      reason: "modify src/app.ts",
      target: "src/app.ts",
      scope: "Patch src/app.ts",
      canRememberAllow: true,
      canRememberDeny: true,
    });

    controller.denySelection();

    await expect(pending).resolves.toEqual({ outcome: "deny" });
    expect(controller.getState()).toBeNull();
  });
});
