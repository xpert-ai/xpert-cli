# xpert-cli Architecture

## Main Path

1. `xpert-cli` resolves project root from `--cwd`, `git rev-parse --show-toplevel`, or the current shell cwd.
2. It loads config from env, `~/.xpert-cli/config.json`, and `.xpert-cli.json`.
3. It opens or creates a local session file in `~/.xpert-cli/sessions/<session-id>.json`.
4. It picks one of two UI paths:
   - interactive TTY: Ink-based minimal TUI
   - `-p` and non-TTY: existing text renderer
5. It sends the user prompt to `xpert-pro` through `@xpert-ai/xpert-sdk`.
6. On every new run and every tool-resume call, it rebuilds a short local context snapshot from:
   - `XPERT.md` / `xpert.md`
   - current `cwd`
   - `projectRoot`
   - `git status --short`
   - recent tool-call summaries
   - recent changed files
7. It passes local tool schemas and structured local context through `runs.stream(..., { context: ... })`.
8. It also prepends a hidden local-context envelope to the outbound prompt, and to the first outbound tool message on resume, so the model still sees the context even if arbitrary run `context` fields are not injected into model-visible text upstream.
9. `agent-loop` emits structured UI events through a UI sink instead of writing directly to stdout.
   - `TextUiRenderer` keeps the existing line-oriented output for `-p`, non-TTY, and tests
   - `InkUiSink` maps runtime events into static history plus current pending turn state
10. When `xpert-pro` interrupts with a client tool call, the CLI:
   - checks permissions,
   - deduplicates repeated `callId`s and blocks tight identical-call loops,
   - executes the tool on the local host backend,
   - streams local command output and write/patch diff in the terminal,
   - resumes the same execution with `command.resume.toolMessages`.
11. Interactive Ink mode keeps command results and local slash-command views in the history stream while rendering the active turn separately as pending state.
12. Interactive mode can cancel the current turn with `Ctrl+C` without exiting the whole REPL.
13. After each turn, it refreshes checkpoint state and persists session metadata locally.

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

## Limits

- No Docker or remote sandbox backend yet.
- No login/logout flow beyond API key auth.
- `Patch` is not a full unified patch parser; it only supports exact replace, line-range replace, and sequential multi-edit operations.
- `Write` will not overwrite an existing file; modifying existing files must go through `Patch`.
- Session resume restores thread/session context, but not an already-open SSE connection.
- Repeated tool-call protection is scoped to the active turn only.
- The Ink UI is intentionally minimal:
  - no alternate buffer mode
  - no mouse support
  - no vim mode
  - no theme system
  - no shell side panel
- Local context is clipped aggressively to stay short:
  - `XPERT.md` and `git status --short` are truncated
  - recent files and recent tool calls are capped to a small tail
