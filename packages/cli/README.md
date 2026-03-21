# @xpert-ai/xpert-cli

Local-first terminal coding agent for the `xpert` platform.

## Install

```bash
npm install -g @xpert-ai/xpert-cli
```

## Configure

Set the same environment variables used in the source workspace:

```bash
export XPERT_API_URL=http://localhost:3000/api
export XPERT_API_KEY=your-api-key
export XPERT_AGENT_ID=your-agent-id
```

Optional project config can be stored in `.xpert-cli.json`:

```json
{
  "approvalMode": "default",
  "sandboxMode": "host"
}
```

## Usage

Interactive mode:

```bash
xpert
```

Single prompt:

```bash
xpert -p "Read package.json and summarize it"
```

Resume the latest project session:

```bash
xpert resume
```

## Notes

- `xpert-cli` is local-first. File reads, writes, patches, shell commands, and git commands run on the user's host machine.
- `xpert-pro` remains the control plane for threads, runs, auth, and model orchestration.
- The CLI injects clipped local context on each run, including `XPERT.md` / `xpert.md`, cwd, project root, git status, recent tool calls, and recent changed files.
