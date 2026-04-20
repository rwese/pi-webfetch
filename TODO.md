# TODO: Add Clawfetch with Provider Abstraction

## Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Create provider interface types | [x] | `src/providers/types.ts` |
| 2 | Implement DefaultProvider | [x] | Refactor current agent-browser + turndown |
| 3 | Implement ClawfetchProvider | [x] | Wrap clawfetch |
| 4 | Create ProviderManager | [x] | Auto-detect + selection |
| 5 | Add CLI override flag | [x] | `--provider` parameter |
| 6 | Update extension registration | [x] | Use ProviderManager |
| 7 | Add tests for providers | [x] | 67 tests passing |
| 8 | Update AGENTS.md | [x] | Document new architecture |

## Completed

- [2026-04-20] All tasks completed, committed as `22a8f40`
