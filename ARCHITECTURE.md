# xpert-cli Architecture

## Main Path

1. `xpert-cli` resolves project root from `--cwd`, `git rev-parse --show-toplevel`, or the current shell cwd.
2. It loads config from env, `~/.xpert-cli/config.json`, and `.xpert-cli.json`.
3. It opens or creates a local session file in `~/.xpert-cli/sessions/<session-id>.json`.
4. It sends the user prompt to `xpert-pro` through `@xpert-ai/xpert-sdk`.
5. It passes local tool schemas through `runs.stream(..., { context: { clientTools } })`.
6. When `xpert-pro` interrupts with a client tool call, the CLI:
   - checks permissions,
   - deduplicates repeated `callId`s and blocks tight identical-call loops,
   - executes the tool on the local host backend,
   - streams local command output and patch diff in the terminal,
   - resumes the same execution with `command.resume.toolMessages`.
7. Interactive mode can cancel the current turn with `Ctrl+C` without exiting the whole REPL.
8. After each turn, it refreshes checkpoint state and persists session metadata locally.

## Local Backend

`host` is the only working backend in this MVP.

- Reads and writes stay inside the detected project root.
- Writes to `.git/` are blocked.
- `Patch` uses exact string replacement, then prints a unified diff.
- `Bash` streams combined stdout/stderr line-by-line.
- `Bash` supports timeout and abort from the current turn signal.

## Server Assumption

This CLI expects `xpert-pro` to support dynamic client tools from run `context.clientTools`.
That support is added in the accompanying minimal `xpert-pro` patch in this workspace.

## Limits

- No Docker or remote sandbox backend yet.
- No login/logout flow beyond API key auth.
- `Patch` is exact-string only, not full unified patch application.
- Session resume restores thread/session context, but not an already-open SSE connection.
- Repeated tool-call protection is scoped to the active turn only.
