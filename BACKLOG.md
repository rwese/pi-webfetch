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

---

## In Progress 🔄

| Task | Priority | Status | Plan |
|------|----------|--------|-------|
| #4 Resource Cleanup & Concurrency | High | 🔄 Planning | [PLAN_TASK4_RESOURCE_CLEANUP.md](./PLAN_TASK4_RESOURCE_CLEANUP.md) |
| #8 Better Error Messages | Medium | 🔄 In Progress | [docs/plans/PLAN_AGENT_ERROR_RESUME.md](./docs/plans/PLAN_AGENT_ERROR_RESUME.md) |

---

## Remaining Tasks 📋

### High Priority

| Task | Priority | Description |
|------|----------|-------------|
| #4 Resource Cleanup & Concurrency | High | Browser cleanup, concurrency fixes |
| #5 Consolidate URL Detection | Medium | Shared constants for SPA/binary detection |
| #6 GhCliProvider Complete | Medium | Add discussions, releases, commits, gists |
| #8 Better Error Messages | Medium | Actionable suggestions in errors |
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
8. #8 Better errors
9. #12 Security hardening
10. #7 Re-auth check
... rest as time permits

---

## Quick Stats

- **Total tasks:** 19
- **Completed:** 7 (36%)
- **In Progress:** 1
- **Remaining:** 11

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

