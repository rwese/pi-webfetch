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
