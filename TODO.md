# TODO: Merge agent-browser into webfetch

## Tasks - ALL COMPLETE ✓

| # | Task | Status |
|---|------|--------|
| 1 | Merge `fetchUrlWithBrowser` logic into `fetchUrl` | [x] |
| 2 | Try agent-browser first for HTML pages | [x] |
| 3 | Add fallback to static fetch with warning | [x] |
| 4 | Update tests for new behavior | [x] |
| 5 | Update docs | [x] |

## Summary

- `webfetch` now tries `agent-browser` first for HTML pages
- Falls back to static fetch with warning if browser unavailable
- Simplified tests to unit test helpers
- Updated AGENTS.md and README.md
