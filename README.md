# xpert-cli

Local-first terminal coding agent MVP for the `xpert` platform.

## What Works

- `xpert` interactive TTY mode with an inline Ink UI:
  - inline Ink layout without entering the terminal alternate buffer
  - committed history appended into normal terminal scrollback
  - denser committed/live block rendering for user, assistant, tool, bash, diff, notices, and inline inspectors
  - `/status`, `/tools`, and `/session` rendered inline from local state as inspector-style history cards
  - display-width-aware status row, inline permission prompt, and fixed composer
- `xpert -p "..."` single-turn mode
- `xpert auth status`
- `xpert doctor`
- `xpert doctor --json`
- `xpert resume [sessionId]`
- `xpert sessions`
- `xpert sessions list --json`
- `xpert sessions delete <selector>`
- `xpert sessions prune`
- Interactive slash commands:
  - `/status`
  - `/tools`
  - `/session`
  - `/exit`
- Local tools:
  - `Read`
  - `Glob`
  - `Grep`
  - `Write`
  - `Patch`
  - `Bash`
- `GitStatus`
- `GitDiff`
- Local session persistence in `~/.xpert-cli/sessions`
- Remote fingerprint tracking for `apiUrl`, `organizationId`, and `assistantId`
- Automatic stale remote state clearing when backend / org / assistant config changes
- Safe / moderate / dangerous permission checks
- Local host execution by default, not server-side sandbox execution
- Duplicate tool-call reuse and repeated-call guard inside one turn
- `Ctrl+C` cancels the current turn and returns to `xpert>` in interactive mode
- Local session management from `~/.xpert-cli/sessions`:
  - list local sessions for the current project, or across all projects
  - delete a local session by full id or unique id prefix
  - prune older local sessions with an explicit `--yes` guard
  - `resume` restores the latest local session for the current project
  - `resume <unique-prefix>` resolves prefixes only inside the current project
  - `resume <full-session-id>` can restore a local session from another project and switches into that session's saved local project context
- Interactive restart / `resume` now replays recent persisted turn history into inline scrollback:
  - replay comes from the local session file, not a server-side history fetch
  - persisted history is a clipped renderable transcript of recent user / assistant / tool / bash / diff / notice output
  - replay keeps bounded turn, text, bash, diff, and notice limits instead of storing an unlimited raw log
- Automatic local context injection on every run and resume:
  - `XPERT.md` / `xpert.md` content
  - current `cwd`
  - `projectRoot`
  - `git status --short`
  - recent tool-call summaries
  - recent changed files
- Request diagnostics for common backend failures:
  - service unreachable / DNS / timeout / connection refused
  - auth failure (`401` / `403`)
  - assistant not found vs remote thread not found
  - wrong `XPERT_API_URL`, missing route, or protocol mismatch
  - SSE connect failure, mid-run stream interruption, and resume failure
- Startup preflight for interactive, `-p`, and `resume`:
  - missing / invalid `XPERT_AGENT_ID`
  - backend/auth/assistant checks before the first turn
- Active doctor checks for:
  - backend reachability
  - auth validity
  - assistant existence
  - organization header acceptance
  - thread creation

## Install

From npm:

```bash
npm install -g @xpert-ai/xpert-cli
```

From source:

```bash
cd xpert-cli
pnpm install
pnpm build
```

## Configure

Copy `.env.example` to `.env` in the `xpert-cli` root, or export the same variables in your shell.

```bash
cp .env.example .env
```

The CLI loads config in this order:

1. `~/.xpert-cli/config.json`
2. `.xpert-cli.json`
3. `.env`
4. `.env.local`
5. real process env

`reasoning` output is hidden by default. To debug raw reasoning tokens, set `XPERT_CLI_SHOW_REASONING=true`.

Optional project config:

```json
{
  "approvalMode": "default",
  "sandboxMode": "host"
}
```

Save that as `.xpert-cli.json` in the project root.

Optional user config:

`~/.xpert-cli/config.json`

## Usage

Interactive:

```bash
pnpm --dir xpert-cli --filter @xpert-ai/xpert-cli dev
```

When both `stdin` and `stdout` are real TTYs, interactive mode now starts an inline Ink app without entering the terminal alternate buffer:

- committed history is appended above the live footer and remains in normal terminal scrollback
- on restart or `resume`, the CLI replays the recent clipped turn transcript from the local session into committed history before new input
- the current pending turn stays live near the bottom while streamed assistant/tool output is also appended into terminal scrollback during the turn
- `/status`, `/tools`, and `/session` render as inline local inspector cards
- the permission prompt stays inline with tool / risk / scope context
- the composer and status row stay single-line and clip by terminal display width

The main history surface is now the host terminal scrollback, so terminal mouse-wheel scrolling and the terminal scrollbar work naturally again.

Or after build:

```bash
node packages/cli/dist/index.js
```

Single prompt:

```bash
node packages/cli/dist/index.js -p "Read src/index.ts and summarize it"
```

`-p` and non-TTY flows keep the existing text renderer and do not start Ink.

Resume latest session:

```bash
node packages/cli/dist/index.js resume
```

Resume a specific local session by full id or unique prefix:

```bash
node packages/cli/dist/index.js resume 28dfbacc
```

`resume` semantics:

- `resume` restores the latest local session for the current project
- `resume <unique-prefix>` resolves prefixes only inside the current project
- `resume <full-session-id>` restores that exact local session globally and uses the resumed session's saved `projectRoot` and `cwd`
- when `resume <full-session-id>` is combined with `--cwd`, the override must stay inside the resumed session's project; it only overrides `cwd`, never `projectRoot`

Manage local sessions without contacting the backend:

```bash
node packages/cli/dist/index.js sessions
node packages/cli/dist/index.js sessions list --json
node packages/cli/dist/index.js sessions delete 28dfbacc
node packages/cli/dist/index.js sessions prune --keep 5 --yes
```

Health checks:

```bash
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js doctor --json
node packages/cli/dist/index.js auth status
```

When a saved local session points at stale remote run state because `XPERT_API_URL`, `XPERT_ORGANIZATION_ID`, or `XPERT_AGENT_ID` changed, the CLI now keeps the local session history but clears the stale remote `threadId`, `runId`, and `checkpointId` before the next turn.

`xpert sessions`, `xpert sessions list`, `xpert sessions delete`, and `xpert sessions prune` are local-only commands. They read and mutate files in `~/.xpert-cli/sessions` directly and do not require backend reachability or a valid `XPERT_AGENT_ID`.

Cancel a stuck turn in interactive mode:

```text
Press Ctrl+C once
```

This cancels the current run or local tool execution and drops back to `xpert>`.

## Slash Commands

Inside the Ink interactive TTY UI:

- `/status` prints inline status output from local runtime state
- `/tools` prints inline tool output from the local registry and session data
- `/session` prints inline session output from local turn transcripts
- `/exit` closes the interactive session

These commands are resolved locally from runtime state and do not call the model. In interactive mode they render as inline inspector-style history cards; in `-p` and non-TTY flows, the existing text renderer remains unchanged.

## Interactive Keys

- `Ctrl+C`: cancel the current turn; press again to exit
- `Esc`: deny the active permission prompt
- `Up` / `Down`: browse input history in the composer
- terminal scrollback / mouse wheel / terminal scrollbar: review interactive history

## Demo Flow

1. Start a local `xpert-pro` that includes the matching client-tools patch.
2. Set `XPERT_API_URL`, `XPERT_API_KEY`, and `XPERT_AGENT_ID`.
3. Open a git project.
4. Run:

```bash
node packages/cli/dist/index.js -p "Read package.json and summarize it"
```

5. Run:

```bash
node packages/cli/dist/index.js -p "Search for TODO and show me where it appears"
```

6. Run:

```bash
node packages/cli/dist/index.js -p "Change the greeting string in src/demo.ts to Hello from xpert-cli"
```

The CLI should show streamed text, local tool execution, write/patch diff, and store the session locally.

## Editing Tools

- `Write` creates a new file only. It creates parent directories when needed, fails if the file already exists, and shows a unified diff from an empty file to the new content.
- `Patch` edits existing files with verified, in-memory transforms and shows a unified diff after success.
- `Patch` supports exact string replacement, line-range replacement with `startLine` and `endLine`, and sequential `multi` edits that combine replace and range operations.
- `Patch` validates every edit before writing, so failed multi-edit requests do not leave partial file changes behind.

## Tests

```bash
pnpm test
```

Covered areas:

- path escape blocking
- `.git/` write blocking
- dangerous command detection
- session store persistence
- stream interrupt to tool-call adaptation
- host write and patch execution
- multi-edit atomicity
- duplicate tool-call guard
- turn cancellation wiring
- local context truncation and request injection
- request error normalization for service, auth, URL/protocol, stream, and resume failures

## Publish

The public npm package name is `@xpert-ai/xpert-cli`.

- Only `packages/cli` is published. The workspace root remains private.
- GitHub Actions publishes on tag push `cli-v<version>` or manual `workflow_dispatch`.
- The tag version must match `packages/cli/package.json`.
- Add `NPM_TOKEN` to the GitHub repository secrets before publishing.

Local pre-publish verification:

```bash
pnpm test
pnpm build
cd packages/cli
npm pack --dry-run
npm pack
TMP_DIR="$(mktemp -d)"
npm install --prefix "$TMP_DIR" -g ./xpert-ai-xpert-cli-$(node -p "require('./package.json').version").tgz
"$TMP_DIR/bin/xpert" --help
```

## Known Limits

- `host` is the only implemented backend.
- API key auth only.
- Dynamic local tools depend on the accompanying `xpert-pro` patch.
- `Patch` does not support full unified patch syntax; it supports exact replace, line-range replace, and sequential multi-edit only.
- `Write` is create-only and will not overwrite existing files.
- Repeated-call protection is per turn, not global across all future sessions.
- Local context is intentionally clipped per run:
  - `XPERT.md` content is truncated
  - `git status --short` is line-limited
  - recent files and tool-call summaries are count-limited
- The Ink UI is intentionally minimal:
  - interactive Ink now runs inline without entering the terminal alternate buffer
  - history review is delegated to host terminal scrollback, not a complex in-app viewport
  - no mouse support
  - no vim mode
  - no theme system
  - no background shell panel
  - no large dialog framework
