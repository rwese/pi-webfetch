# Project Backlog

## Completed ✅

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| #1 Fix Markdown-Escaping Tests | High | ✅ Done | Tests passing |
| #2 GhCliProvider Unit Tests | High | ✅ Done | Partial - reliable tests added |
| #3 Fallback Chain Tests | High | ✅ Done | 16 tests |
| #9 Real URL Regression Suite | High | ✅ Done | 10 cases, 41 tests |
| Add bot protection flag | - | ✅ Done | |
| Add Reddit RSS fast path | - | ✅ Done | |
| Add GitHub structured data | - | ✅ Done | |
| #8 Better Error Messages | Medium | ✅ Done | Resumable subagent sessions, resume commands, and notify surfaces |

---

## In Progress 🔄

| Task | Priority | Status | Plan |
|------|----------|--------|-------|
| #4 Resource Cleanup & Concurrency | High | 🔄 Planning | [PLAN_TASK4_RESOURCE_CLEANUP.md](./PLAN_TASK4_RESOURCE_CLEANUP.md) |

---

## Remaining Tasks 📋

### High Priority

| Task | Priority | Description |
|------|----------|-------------|
| #4 Resource Cleanup & Concurrency | High | Browser cleanup, concurrency fixes |
| #5 Consolidate URL Detection | Medium | Shared constants for SPA/binary detection |
| #6 GhCliProvider Complete | Medium | Add discussions, releases, commits, gists |
| #7 Re-authentication Check | Medium | TTL on auth, refresh method |

### Low Priority

| Task | Priority | Description |
|------|----------|-------------|
| #10 Retry Logic | Low | Exponential backoff |
| #11 Bot Protection | Low | FlareSolverr integration |
| #12 Security Hardening | Low | Token security, XSS prevention |
| #13 Dead Code Cleanup | Low | Remove unused code |
| #14 Provider Health Checks | Low | Monitor provider health |
| #15 Normalize Timeout Units | Low | Consistent timeouts |
| #16 Proxy Support | Low | HTTP proxy configuration |
| #17 User Agent Override | Low | Custom user agent |
| #18 Custom Headers | Low | Headers per request |
| #19 Documentation | Low | Update docs |

---

## Priority Order (Updated)

1. ~~#1 Fix tests~~ ✅
2. ~~#2 GhCliProvider tests~~ ✅
3. ~~#3 Fallback chain tests~~ ✅
4. ~~#9 Regression suite~~ ✅
5. **#4 Resource cleanup** ← CURRENT
6. #5 Consolidate detection
7. #6 GhCliProvider complete
8. ~~#8 Better errors~~ ✅
9. #12 Security hardening
10. #7 Re-auth check
... rest as time permits

---

## Quick Stats

- **Total tasks:** 22
- **Completed:** 8 (36%)
- **In Progress:** 1
- **Remaining:** 13

---

## Review Findings — 2026-06-05 (hands-on review of v0.7.0)

Surfaced by exercising the extension against `https://nope.at`,
`https://en.wikipedia.org/wiki/Playwright_(software)`, and
`https://github.com/microsoft/playwright` with the `webfetch` tool
and the local CLI (`node dist/extensions/cli.js …`).

| ID | Priority | Task | Notes |
|----|----------|------|-------|
| `2026-06-05-BXBE` | High | ✅ **Fixed: `webfetch` GitHub URL routes to `default` instead of `gh-cli`** | Provider selection now aggregates URL detection across available providers; authenticated GitHub URLs prefer `gh-cli`. Verified with `createProviderManager().selectProvider('https://github.com/microsoft/playwright') → gh-cli`. |
| `2026-06-05-BXBF` | Medium | ✅ **Fixed: Wikipedia article carries nav/footer noise** | MediaWiki navboxes, print footers, footer chrome, and category links are stripped in static and browser conversion paths; regression test added. |
| `2026-06-05-BXBG` | High | ✅ **Fixed: CLI `webfetch` with no flags covered** | Added compiled CLI regression for deterministic plain-text `webfetch <url>` output with empty stderr. |
| `2026-06-05-BXBH` | Medium | ✅ **Covered: Hybrid extraction selectors not unit-tested** | Existing `BrowserManager` extraction tests pin article/main/body fallback selection; provider routing regression added for GitHub selector path. |
| `2026-06-05-BXBI` | Low | ✅ **Fixed: `clear-cache` / `cache-stats` negative-path tests** | Added tests for uncached URL clear miss and stats after clear. |

### Why the gh-cli route did not win

Working theory (unverified — no code change yet):

1. `providers --json` reports `gh-cli.available: true`, so the binary is on `$PATH` and `--version` parses. That only proves the CLI is **installed**, not that it is **authenticated**.
2. The provider is also surfaced with `priority: 8` against `default: 10`. The AGENTS.md note ("prefer `gh-cli` when authenticated") implies the manager overrides priority on authenticated GitHub URLs, but the live output for `github.com/microsoft/playwright` shows `provider: default`. So either the override is not firing or `gh-cli.isAvailable()` returns `false` because `gh auth status` is non-zero in this environment.
3. `webfetch` with no `--provider` flag is what the user-facing path uses, so this is the default behaviour, not an opt-in miss.

Repro before changing code:

```sh
gh auth status
node dist/extensions/cli.js webfetch https://github.com/microsoft/playwright --json | jq '.provider,.method'
```

If `gh auth status` is non-zero → expected behaviour, document it in the README and add a test that asserts `default` wins when gh is not authenticated.

If `gh auth status` is OK → bug in `detectUrl` / manager selector. Fix in `extensions/fetch.ts` and add a regression test that mocks an authenticated `gh-cli.isAvailable()` and asserts the URL routes there.

---

## Notes

- Task #4 (Resource Cleanup) is flagged as critical for production use
- Concurrency issues could cause resource leaks under load
- Browser processes not being cleaned up properly

---

## GitHub fetch gaps

The GitHub fetch path (gh-cli provider + related surfaces) is intentionally
narrow today. The following gaps were surfaced during the review of
[`PLAN_GH_FETCH_OPTIONS.md`](./plans/PLAN_GH_FETCH_OPTIONS.md) and are
deferred to future slices. They are recorded here so the boundary of the
"issues + PR review threads via includeComments" feature is explicit.

| Gap | Notes |
|-----|-------|
| Git-protocol URLs | `git+https://...`, `ssh://git@github.com/...`, and bare `.git` URLs are not handled by the gh-cli provider. They fall through to the default provider and currently surface whatever HTML the host returns. |
| GitHub Enterprise hosts | Hosts other than `github.com` / `www.github.com` / `raw.githubusercontent.com` are not recognised by `parseGitHubUrl` / `detectGitHubUrl`. Enterprise customers need a host allowlist. |
| Recursive directory listings | `fetchDirectory` returns the top-level contents of a tree only. Cross-file link following and recursive expansion are out of scope. |
| PR diffs | The `gh pr view` fast path does not return diffs, checks, or file-level comments. The provider's `metadata` does not include them either. |
| "Open issues in repo" expansion | Fetching a repo does not expand its open issues; callers must walk each issue URL individually. |
| Size guard on `fetchFile` raw content | `fetchRawContent` is `curl`-based and has no size limit; large files could blow past the 100KB truncation step. |
| Detector disagreement on `raw.githubusercontent.com` | The manager-level selector bypasses gh-cli for raw URLs (so the static fetch wins), but the gh-cli provider still detects them. Document / align. |
| gh-cli as a hard requirement for GitHub fast path | The current chain prefers gh-cli and only falls back to clawfetch/default if it is unavailable. Some users without an authenticated `gh` want the default provider to win. |
| Auto-fetching of referenced issues/PRs | A fetched body that references another issue/PR is not auto-expanded. |
| Additional GitHub fetch options | Only `includeComments` is implemented today. Future options (`includeReviews`, `maxCommentDepth`, `includeReactions`) are additive on `GitHubFetchOptions`. |

