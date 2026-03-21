# xpert-cli

Local-first terminal coding agent MVP for the `xpert` platform.

## What Works

- `xpert` interactive mode
- `xpert -p "..."` single-turn mode
- `xpert auth status`
- `xpert doctor`
- `xpert resume [sessionId]`
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
- Safe / moderate / dangerous permission checks
- Local host execution by default, not server-side sandbox execution
- Duplicate tool-call reuse and repeated-call guard inside one turn
- `Ctrl+C` cancels the current turn and returns to `xpert>` in interactive mode
- Automatic local context injection on every run and resume:
  - `XPERT.md` / `xpert.md` content
  - current `cwd`
  - `projectRoot`
  - `git status --short`
  - recent tool-call summaries
  - recent changed files

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

Or after build:

```bash
node packages/cli/dist/index.js
```

Single prompt:

```bash
node packages/cli/dist/index.js -p "Read src/index.ts and summarize it"
```

Resume latest session:

```bash
node packages/cli/dist/index.js resume
```

Health checks:

```bash
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js auth status
```

Cancel a stuck turn in interactive mode:

```text
Press Ctrl+C once
```

This cancels the current run or local tool execution and drops back to `xpert>`.

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
- No heavy TUI, no MCP, no repo map, no plugin ecosystem in this MVP.
