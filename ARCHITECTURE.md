# xpert-cli Architecture

## Main Path

1. `xpert-cli` resolves project root from `--cwd`, `git rev-parse --show-toplevel`, or the current shell cwd.
2. It loads config from env, `~/.xpert-cli/config.json`, and `.xpert-cli.json`.
3. It opens or creates a local session file in `~/.xpert-cli/sessions/<session-id>.json`.
3.1. Local session-management commands (`xpert sessions ...`) and `resume <selector>` resolve session ids and unique id prefixes from those local files before any backend preflight.
4. Before entering interactive, `-p`, or `resume`, it compares a saved remote fingerprint (`apiUrl`, `organizationId`, `assistantId`) against the current config.
5. If that fingerprint changed, it keeps local transcripts / recent files / approvals but clears stale remote `threadId`, `runId`, and `checkpointId`, then shows a short local warning.
6. It runs a light preflight before the first turn to catch missing assistant config, missing assistants, auth failures, and obvious backend issues early.
7. It picks one of two UI paths:
   - interactive TTY: inline Ink app without entering the terminal alternate buffer
   - `-p` and non-TTY: existing text renderer
8. It sends the user prompt to `xpert-pro` through `@xpert-ai/xpert-sdk`.
9. On every new run and every tool-resume call, it rebuilds a short local context snapshot from:
   - `XPERT.md` / `xpert.md`
   - current `cwd`
   - `projectRoot`
   - `git status --short`
   - recent tool-call summaries
   - recent changed files
10. It passes local tool schemas and structured local context through `runs.stream(..., { context: ... })`.
11. It also prepends a hidden local-context envelope to the outbound prompt, and to the first outbound tool message on resume, so the model still sees the context even if arbitrary run `context` fields are not injected into model-visible text upstream.
12. `agent-loop` emits structured runtime facts through a UI sink instead of writing directly to stdout.
   - `TextUiRenderer` keeps the existing line-oriented output for `-p`, non-TTY, and tests
   - `InkUiSink` maps runtime events into static history plus current pending turn state
13. When `xpert-pro` interrupts with a client tool call, the CLI:
   - checks permissions,
   - deduplicates repeated `callId`s and blocks tight identical-call loops,
   - executes the tool on the local host backend,
   - streams local command output and write/patch diff in the terminal,
   - resumes the same execution with `command.resume.toolMessages`.
14. Interactive Ink mode now renders an inline layout with:
   - append-only committed history rendered through Ink `Static`
   - startup / resume replay of the recent clipped local turn transcript into committed history
   - a live pending-turn tail rendered below committed history while streamed assistant/tool output is appended into host scrollback during the turn
   - inline local slash-command output for `/status`, `/tools`, and `/session`, rendered with the same inspector data used by the optional Ink panels
   - a shared block renderer for committed history and the live tail, with clearer tool / bash / diff / notice hierarchy
   - an inline busy status row, permission prompt, and composer that clip by terminal display width instead of raw string length
14.1. Because interactive TTY no longer enters the terminal alternate buffer:
   - committed history lands in normal host terminal scrollback
   - terminal mouse-wheel scrolling and the terminal scrollbar become the main history navigation surface again
14.2. The replay source is local session persistence, not a server-side history fetch:
   - each saved turn keeps the existing summary transcript plus a clipped renderable transcript for recent user / assistant / tool / bash / diff / notice items
   - render transcripts are bounded by recent-turn count, per-turn item count, text size, bash lines, diff size, and notice count
   - older sessions that only have summary transcripts still load; they just skip replay for turns without render items
15. `interactive.tsx` still owns local UI state:
   - composer input and input-history browsing
   - permission prompt display state
   - active turn cancel handle
   - append-only committed history batches plus live pending-turn state
15.1. The interactive UI runtime is split into small local helpers:
   - `ui/tui-runtime.ts`: alternate buffer enter / restore
   - `ui/history.ts`: pending-turn materialization into committed history items
   - `ui/render-blocks.ts`: committed history and pending state -> render blocks
16. `agent-loop` does not own:
   - composer text
   - local permission prompt UI transitions
17. Interactive mode can cancel the current turn with `Ctrl+C` without exiting the whole REPL, while `Esc` stays local to permission denial.
18. Text mode and Ink mode still diverge at the CLI boundary:
   - interactive TTY uses the inline Ink layout and host terminal scrollback
   - `-p` and non-TTY keep the existing text renderer and do not depend on Ink panels
19. After each turn, it refreshes checkpoint state and persists session metadata locally.
19.1. Local session-management commands stay entirely in `xpert-cli`:
   - `sessions list` defaults to the current `projectRoot`, with `--all-projects` for cross-project inspection
   - `sessions delete` deletes one local session file selected by full id or unique prefix
   - `sessions prune` deletes older local session files only after an explicit `--yes`
20. CLI request failures are normalized in the local SDK layer so both Ink and text mode show short diagnostics with target URL and next-step hints for service, auth, assistant-not-found, remote-thread-not-found, URL/protocol, stream, and resume failures.

## Local Backend

`host` is the only working backend in this MVP.

- Reads and writes stay inside the detected project root.
- Writes to `.git/` are blocked.
- `Write` is create-only: it creates parent directories when needed, fails if the file already exists, and prints a unified diff from an empty file to the new content.
- `Patch` supports exact replace, line-range replace, and sequential multi-edit operations on a single file.
- `Patch` computes every edit in memory first and writes once, so a failed multi-edit request does not leave partial file changes behind.
- `Bash` streams combined stdout/stderr line-by-line.
- `Bash` supports timeout and abort from the current turn signal.

## Server Assumption

This CLI expects `xpert-pro` to support dynamic client tools from run `context.clientTools`.
That support is added in the accompanying minimal `xpert-pro` patch in this workspace.

## Request Failure Diagnostics

- `ensureThread`, assistant lookup, `runs/stream`, tool-result resume, and checkpoint fetch failures are normalized inside `xpert-cli`.
- The CLI distinguishes service unreachable, auth failure, assistant not found, remote thread not found, missing route / protocol mismatch, SSE connect failure, mid-run stream interruption, and resume failure.
- User-visible output stays short and actionable, typically including `XPERT_API_URL`, a concise detail line, and hints such as `xpert doctor` or `xpert auth status`.

## Doctor

- `xpert doctor` now performs active checks instead of dumping raw config.
- The full doctor path verifies:
  - config presence for `XPERT_API_URL`, `XPERT_API_KEY`, and `XPERT_AGENT_ID`
  - backend reachability
  - auth acceptance
  - assistant existence
  - organization header acceptance
  - thread creation
- `xpert doctor --json` keeps a lightweight machine-readable report.

## Limits

- No Docker or remote sandbox backend yet.
- No login/logout flow beyond API key auth.
- `Patch` is not a full unified patch parser; it only supports exact replace, line-range replace, and sequential multi-edit operations.
- `Write` will not overwrite an existing file; modifying existing files must go through `Patch`.
- Session resume restores thread/session context, but not an already-open SSE connection.
- Repeated tool-call protection is scoped to the active turn only.
- The Ink UI is intentionally minimal:
  - interactive mode is inline and relies on host terminal scrollback instead of a complex in-app viewport
  - no mouse support
  - no vim mode
  - no theme system
  - no shell side panel
- Local context is clipped aggressively to stay short:
  - `XPERT.md` and `git status --short` are truncated
  - recent files and recent tool calls are capped to a small tail
