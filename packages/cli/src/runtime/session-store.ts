import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PermissionRecord, ToolCallSummary } from "@xpert-cli/contracts";

export interface CliSessionState {
  sessionId: string;
  threadId?: string;
  runId?: string;
  checkpointId?: string;
  assistantId?: string;
  cwd: string;
  projectRoot: string;
  recentFiles: string[];
  recentToolCalls: ToolCallSummary[];
  approvals: PermissionRecord[];
  createdAt: string;
  updatedAt: string;
}

export class SessionStore {
  readonly #sessionDir: string;

  constructor(userConfigDir: string) {
    this.#sessionDir = path.join(userConfigDir, "sessions");
  }

  get sessionDir(): string {
    return this.#sessionDir;
  }

  async ensure(): Promise<void> {
    await mkdir(this.#sessionDir, { recursive: true });
  }

  async create(input: {
    cwd: string;
    projectRoot: string;
    assistantId?: string;
  }): Promise<CliSessionState> {
    const now = new Date().toISOString();
    return {
      sessionId: randomUUID(),
      assistantId: input.assistantId,
      cwd: input.cwd,
      projectRoot: input.projectRoot,
      recentFiles: [],
      recentToolCalls: [],
      approvals: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  async load(sessionId: string): Promise<CliSessionState | null> {
    try {
      const raw = await readFile(this.getSessionPath(sessionId), "utf8");
      return JSON.parse(raw) as CliSessionState;
    } catch {
      return null;
    }
  }

  async list(): Promise<CliSessionState[]> {
    await this.ensure();
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(this.#sessionDir, { withFileTypes: true });
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => this.load(entry.name.replace(/\.json$/, ""))),
    );

    return sessions
      .filter((item): item is CliSessionState => Boolean(item))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async resolveLatest(): Promise<CliSessionState | null> {
    const sessions = await this.list();
    return sessions[0] ?? null;
  }

  async resolveLatestForProjectRoot(projectRoot: string): Promise<CliSessionState | null> {
    const normalizedRoot = path.resolve(projectRoot);
    const sessions = await this.list();
    return (
      sessions.find((session) => path.resolve(session.projectRoot) === normalizedRoot) ??
      null
    );
  }

  async save(session: CliSessionState): Promise<void> {
    await this.ensure();
    const payload: CliSessionState = {
      ...session,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(
      this.getSessionPath(payload.sessionId),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }

  getSessionPath(sessionId: string): string {
    return path.join(this.#sessionDir, `${sessionId}.json`);
  }
}
