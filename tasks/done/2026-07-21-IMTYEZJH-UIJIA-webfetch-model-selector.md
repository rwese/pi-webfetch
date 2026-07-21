## Context

<goal syntax="markdown">Add a persistent research-subagent model selector to pi-webfetch, modeled on pi-dynamic-workflows, and use the selected configured Pi model whenever the extension runs research mode.</goal>

## Scope

**In Scope:**

- `/webfetch:model` scrollable model selector backed by the host model registry.
- Global extension configuration under Pi’s agent directory.
- Research subprocess provider/model argv wiring for the pi tool and slash command.
- Regression tests and user documentation.

**Out of Scope:**

- Per-call CLI/MCP model flags.
- Thinking-level selection.
- Changing the parent session model.

## Acceptance Criteria

- [x] `/webfetch:model` lists and searches available configured models and a Pi-default option.
- [x] Selection persists across sessions.
- [x] Pi tool and `/webfetch` research runs pass the selected provider/model to the child.
- [x] Clearing selection restores Pi’s normal child-model resolution.
- [x] Invalid configuration fails safely and save errors are shown exactly.
- [x] Focused tests and `npm run validate` pass.

## First Verifiable State

- [x] Add failing config, command, and argv regression tests.
- [x] Verify with: `npm test -- --run test/webfetch-model-config.test.ts test/webfetch-model-command.test.ts test/pi-agent.test.ts test/webfetch-research.test.ts`.

## Implementation Notes

- Reuse the `ctx.ui.custom()` + `SelectList` pattern from `/Users/wese/sandpit/pi-dynamic-workflows/src/workflows-models-command.ts`.
- Read available models from `ctx.modelRegistry.getAvailable()` so extension-registered providers appear.
- Persist `{ researchModel: { provider, id } }` at `join(getAgentDir(), "pi-webfetch.json")`.
- Thread the optional model through `webfetchResearch` to `spawnPiAgent`, which emits `--provider` and `--model`.

## Incremental Plan

1. **[Verification First]** — Add failing persistence, selector, and argv/threading tests.
2. **[Core Logic]** — Implement config module, command, and research model plumbing.
3. **[Polish]** — Handle empty/stale registries and save/load failures; update README, CHANGELOG, and AGENTS architecture notes.

## Definition of Done

- [x] First verification passes
- [x] Core functionality complete
- [x] Logic verified
- [x] No debug code or TODOs
- [x] Changes documented

## Result

Added `/webfetch:model` with searchable filtering over available Pi providers,
model IDs, and display names. The selection persists in Pi's agent directory,
applies to extension research subprocesses without changing the parent model,
and is covered by config, command, argv, and research-service regression tests.
