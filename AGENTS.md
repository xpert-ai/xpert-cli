# xpert-cli Agent Notes

## Purpose

`xpert-cli` is the local-first terminal coding agent in this workspace.

Its job is to:

- talk to `xpert-pro` for model, thread, run, auth, and policy
- execute tools on the user's local machine by default
- preserve local CLI UX such as permissions, streaming shell output, session restore, and turn cancel

Do not turn `xpert-cli` into a thin UI over server-side sandbox execution.

## Workspace Map

### Primary related repos

- `xpert-cli/`
  - local terminal agent
  - owns host execution, tool registry, permission prompts, session files, REPL UX
- `xpert-pro/`
  - control plane and AI server
  - owns threads, runs, checkpoints, auth, organization policy, model routing
  - may need small protocol fixes so CLI-executed tools can resume the same run
- `xpert-sdk-js/`
  - TypeScript SDK used by the CLI to talk to `xpert-pro`
  - preferred place for shared API contracts, but CLI-local adapters are still acceptable for MVP gaps

### Useful references, but not the main runtime path

- `code-xpert/`
  - separate product focused on code review and task workflows
  - useful for API patterns and existing `xpert-sdk` client usage
  - not the execution backend for `xpert-cli`
- `chatkit-js/`
  - chat UI framework and streaming interaction patterns
  - useful for front-end and conversation UX ideas
  - not a dependency that should define the CLI architecture
- `xpert/`
  - older/main platform monorepo with similar domain concepts
  - useful for shared conventions and plugin/server patterns
- `xpert-plugins/`
  - plugin ecosystem for platform-side extensions
  - not the place to implement the default local CLI tool path
- `xpertai-chatkit-advanced-samples/`
  - example apps around ChatKit
  - reference only

## Architectural Position

The intended request path is:

1. user runs `xpert-cli`
2. CLI sends prompt and client tool schema through `xpert-sdk-js`
3. `xpert-pro` runs the model and emits stream events
4. CLI receives tool calls and executes them locally
5. CLI resumes the same remote run with tool results

The important boundary is:

- local file reads, patches, shell commands, and git commands belong to `xpert-cli`
- remote orchestration belongs to `xpert-pro`

## Change Rules

- Default to changing only `xpert-cli`
- Touch `xpert-sdk-js` only when the CLI is blocked by missing SDK surface
- Touch `xpert-pro` only when the server protocol cannot support client-executed tools or proper resume
- Keep cross-repo patches minimal and explain why they are necessary
- Do not push the first-class execution path into Docker sandbox or server-local execution

## Read First

When starting work in `xpert-cli`, read these first:

- `README.md`
- `ARCHITECTURE.md`
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/sdk/client.ts`

If protocol behavior is unclear, then inspect:

- `../xpert-sdk-js/packages/core/src/client.ts`
- `../xpert-sdk-js/packages/core/src/schema.ts`
- `../xpert-pro/packages/server-ai/src/ai/thread.controller.ts`
- `../xpert-pro/packages/server-ai/src/sandbox/sandbox.service.ts`

## Current Product Intent

Current MVP intent is straightforward:

- default backend is `host`
- local execution is the main feature, not a fallback
- `xpert-pro` is the control plane
- sandbox backends may exist later, but they are optional execution backends, not the default path
