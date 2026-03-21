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
  - `Patch`
  - `Bash`
  - `GitStatus`
  - `GitDiff`
- Local session persistence in `~/.xpert-cli/sessions`
- Safe / moderate / dangerous permission checks

## Install

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
pnpm --dir xpert-cli --filter @xpert-cli/cli dev
```

Or after build:

```bash
./packages/cli/dist/index.js
```

Single prompt:

```bash
./packages/cli/dist/index.js -p "Read src/index.ts and summarize it"
```

Resume latest session:

```bash
./packages/cli/dist/index.js resume
```

Health checks:

```bash
./packages/cli/dist/index.js doctor
./packages/cli/dist/index.js auth status
```

## Demo Flow

1. Start a local `xpert-pro` that includes the matching client-tools patch.
2. Set `XPERT_API_URL`, `XPERT_API_KEY`, and `XPERT_AGENT_ID`.
3. Open a git project.
4. Run:

```bash
./packages/cli/dist/index.js -p "Read package.json and summarize it"
```

5. Run:

```bash
./packages/cli/dist/index.js -p "Search for TODO and show me where it appears"
```

6. Run:

```bash
./packages/cli/dist/index.js -p "Change the greeting string in src/demo.ts to Hello from xpert-cli"
```

The CLI should show streamed text, local tool execution, patch diff, and store the session locally.

## Tests

```bash
pnpm test
```

Covered areas:

- path escape blocking
- dangerous command detection
- session store persistence
- stream interrupt to tool-call adaptation
- host patch execution

## Known Limits

- `host` is the only implemented backend.
- API key auth only.
- Dynamic local tools depend on the accompanying `xpert-pro` patch.
- `Patch` only supports exact string replacement.
- No heavy TUI, no MCP, no repo map, no plugin ecosystem in this MVP.
