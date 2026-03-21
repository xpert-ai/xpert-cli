import { describe, expect, it } from "vitest";
import { detectDangerousCommand } from "../permissions/danger-patterns.js";

describe("detectDangerousCommand", () => {
  it("matches destructive shell commands", () => {
    expect(detectDangerousCommand("rm -rf /")).toBeTruthy();
    expect(detectDangerousCommand("sudo make install")).toBeTruthy();
    expect(detectDangerousCommand("git reset --hard HEAD~1")).toBeTruthy();
  });

  it("ignores safe commands", () => {
    expect(detectDangerousCommand("git status")).toBeNull();
    expect(detectDangerousCommand("pnpm test")).toBeNull();
  });
});
