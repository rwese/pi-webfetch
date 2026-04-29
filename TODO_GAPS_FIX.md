# Provider System Gap Fixes

## Status: Pending

**Goal:** Can fetch any URL reliably. Real URL regression suite passing.

---

## 🔴 High Priority

### 1. Fix Failing Markdown-Escaping Tests

**Files:** `test/markdown-escaping.test.ts`, `extensions/html.ts`

**Issue:** Code blocks returning empty string after conversion.

**Tests failing:**
- `preserves square brackets in code blocks`
- `preserves escaped brackets in code blocks`
- `preserves backslashes in code blocks`
- `preserves regex patterns in code blocks`
- `preserves Nix string patterns in code blocks`
- `preserves square brackets in inline code`

**Root cause:** ⚠️ Unknown - needs investigation before assuming turndown issue.

**Steps:**
- [ ] Investigate: Is the HTML being extracted correctly first? Add debug logging
- [ ] Check if `<pre>` and `<code>` elements are present before turndown
- [ ] If HTML extraction is fine: Add rule to preserve code block content verbatim
- [ ] If HTML extraction fails: Fix extraction before turndown
- [ ] Run `npm test` to verify all pass
- [ ] Add regression test for edge cases

---

### 2. Add GhCliProvider Unit Tests

**Files:** `test/providers.test.ts`, `src/providers/gh-cli.ts`

**Current coverage:** Only static tests (name, priority, capabilities). No functional tests.

**Missing coverage:**
- `parseGitHubUrl()` - edge cases (issues, PRs, repos, tree/blob paths)
- `fetchIssue()` - verify JSON parsing and markdown formatting
- `fetchPr()` - verify metadata extraction
- `fetchRepo()` - verify language parsing
- `isAvailable()` - auth failure scenarios

**Steps:**
- [ ] Mock `execSync` for gh CLI calls using `vi.mock()`
- [ ] Test `parseGitHubUrl()` with valid/invalid URLs (all GitHub URL types)
- [ ] Test `fetchIssue()` with mock gh JSON output
- [ ] Test `fetchPr()` with mock gh JSON output
- [ ] Test `fetchRepo()` with mock gh JSON output
- [ ] Test authentication failure path

---

### 3. Add Integration Test for Provider Fallback Chain

**File:** `test/fetch-routing.test.ts` (extend)

**Scenario:** When primary provider fails, verify fallback is attempted.

**Steps:**
- [ ] Mock DefaultProvider to always fail
- [ ] Verify ClawfetchProvider is attempted as fallback
- [ ] Verify error is returned if all providers fail
- [ ] Test fallback preserves error info from all attempts
- [ ] Document: Which provider tried, what error occurred, retry suggestions

---

## 🟡 Medium Priority

### 4. Implement Resource Cleanup & Fix Concurrency Issues

**Files:** `src/providers/default.ts`, `src/providers/manager.ts`

**Issues:**
- Browser instances not cleaned up after use (`close()` not implemented)
- Unknown how concurrent fetches are handled
- Potential resource leaks with browser processes

**Steps:**
- [ ] Add `close(): Promise<void>` method to DefaultProvider
  - Call `agent-browser close` command
  - Handle case where browser is already closed
- [ ] Investigate concurrency model:
  - Is ProviderManager a singleton? If so, is it thread-safe?
  - Are there race conditions with shared browser instances?
  - Consider: per-request instances vs shared pool
- [ ] Add test for cleanup (verify no zombie processes)
- [ ] Document cleanup expectations

---

### 5. Consolidate URL Detection Logic

**Files:** `src/providers/default.ts`, `src/providers/clawfetch.ts`, `src/providers/gh-cli.ts`

**Issue:** Duplicate methods with identical hardcoded lists. SPA indicators list missing from GhCliProvider.

**Steps:**
- [ ] Extract SPA indicators to shared constants
- [ ] Extract binary extensions to shared constants
- [ ] Create `src/providers/utils.ts` with shared detection helpers:
  ```typescript
  export const SPA_INDICATORS = ['reddit.com', 'twitter.com', ...];
  export const BINARY_EXTENSIONS = ['.pdf', '.zip', ...];
  export function checkLikelySPA(url: string): boolean { ... }
  export function checkLikelyBinary(url: string): boolean { ... }
  ```
- [ ] Refactor all providers to use shared utilities
- [ ] Verify GhCliProvider has `checkLikelyBinary()` (currently missing)

---

### 6. Add GhCliProvider Complete Coverage

**Files:** `src/providers/gh-cli.ts`

**Issue:** Only handles issues, PRs, and repos. Missing: discussions, releases, commits, gists.

**Steps:**
- [ ] Add `fetchDiscussion()` - GitHub Discussions API
- [ ] Add `fetchRelease()` - Release notes and assets
- [ ] Add `fetchCommit()` - Commit diffs and messages
- [ ] Add `fetchGist()` - Gist content
- [ ] Update `parseGitHubUrl()` to detect all types
- [ ] Add tests for new URL types

---

### 7. Add GhCliProvider Re-authentication Check

**File:** `src/providers/gh-cli.ts`

**Issue:** `authenticated` status cached forever. Token expiry not detected.

**Steps:**
- [ ] Add TTL to authentication check (e.g., 5 minutes)
- [ ] Add method to re-check auth status
- [ ] Add public `refreshAuth()` method for external triggering
- [ ] Add `isAuthenticated(): boolean` method for status checks
- [ ] Add test for re-authentication scenario

---

### 8. Improve Error Messages with Actionable Suggestions

**Files:** `src/providers/manager.ts`, all providers

**Issue:** Current errors not helpful for users. Need: which providers tried, error details, fix suggestions, retry hints.

**Steps:**
- [ ] Enhance `NoProviderResult`:
  ```typescript
  interface NoProviderResult {
    success: false;
    error: string;
    attemptedProviders: string[];
    suggestions: string[];  // e.g., "Install gh CLI: https://cli.github.com"
    retryAfter?: number;     // Unix timestamp if rate limited
  }
  ```
- [ ] Add provider-specific suggestions in each provider
- [ ] Detect rate limit errors from GitHub API and set `retryAfter`
- [ ] Update CLI tooltips/help text

---

### 9. Add Real URL Regression Suite

**File:** `test/regression/` (new)

**Goal:** Can fetch any URL reliably. This is the success criteria.

**Steps:**
- [ ] Create `test/regression/cases/` directory
- [ ] Add regression cases for common URL types:
  - GitHub issues (gh-cli)
  - GitHub PRs (gh-cli)
  - GitHub repos (gh-cli)
  - Reddit posts (clawfetch)
  - Simple HTML pages (static fetch)
  - Raw files (static fetch)
  - SPAs (provider)
  - Binary files
- [ ] Implement `npm run report-url` workflow (documented in AGENTS.md)
- [ ] Add `npm run test:regression` command
- [ ] Target: 20+ real URLs with verified expected output

---

## 🟢 Low Priority

### 10. Add Retry Logic with Exponential Backoff

**File:** `src/providers/manager.ts`

**Issue:** Slow fallback chain. Waiting for timeout before trying next provider.

**Steps:**
- [ ] Add `retryConfig` to `ProviderManagerConfig`:
  ```typescript
  interface RetryConfig {
    maxRetries: number;      // default: 3
    baseDelayMs: number;      // default: 1000
    maxDelayMs: number;       // default: 30000
    retryOn: string[];        // error codes to retry on
  }
  ```
- [ ] Implement retry loop in `fetch()`
- [ ] Add jitter to prevent thundering herd
- [ ] Track metrics for retry success/failure (optional)

---

### 11. Add Bot Protection Support

**Files:** `src/providers/clawfetch.ts`, `src/providers/types.ts`

**Issue:** `supportsBotProtection: false` for all providers.

**Decision:** Important but not blocking. Would improve UX significantly.

**Option A - FlareSolverr Integration:**
- [ ] Detect Cloudflare challenge page
- [ ] Call FlareSolverr API to solve challenge
- [ ] Retry fetch with session cookies
- [ ] Add `flareSolverrUrl` config option

**Option B - Skip (Won't fix):**
- External service dependency may not be acceptable
- Document limitation and alternative solutions

---

### 12. Add Security Hardening

**Files:** All providers, `src/providers/types.ts`

**Concerns:**
- gh tokens stored/accessed securely
- Malicious HTML/JS in fetched content (XSS)

**Steps:**
- [ ] Review: How are gh tokens accessed? Any logging?
- [ ] Sanitize extracted content to prevent XSS in output
- [ ] Validate URLs before fetching (prevent SSRF)
- [ ] Document security model

---

### 13. Dead Code Cleanup

**Files:** All providers

**Steps:**
- [ ] Run `npm run fallow` or manual grep to find unused code
- [ ] Identify unused methods, variables, imports
- [ ] Remove dead code paths
- [ ] Verify tests still pass after cleanup

---

### 14. Add Provider Health Checks

**File:** `src/providers/manager.ts`

**Issue:** No way to check provider health beyond availability.

**Steps:**
- [ ] Add `healthCheck()` method to `WebfetchProvider` interface
- [ ] Implement for each provider (e.g., test fetch to known URL)
- [ ] Add `getHealthyProviders()` method
- [ ] Add health check interval option
- [ ] Add `getProviderStatus()` CLI command (documented in fetch.ts)

---

### 15. Normalize Timeout Units

**Files:** All provider files

**Issue:** Confusion between ms (config) and seconds (execSync).

**Steps:**
- [ ] Document timeout contract clearly in types
- [ ] Add validation that timeout is positive
- [ ] Consider using ms everywhere internally

---

### 16. Add Proxy Support to Providers

**Files:** `src/providers/default.ts`, `src/providers/clawfetch.ts`

**Issue:** Proxy config declared but not wired through.

**Steps:**
- [ ] Check if `agent-browser` supports proxy
- [ ] Pass proxy to `clawfetch` via env vars
- [ ] Add proxy test with mock server
- [ ] Document proxy configuration

---

### 17. Add User Agent Override to DefaultProvider

**File:** `src/providers/default.ts`

**Issue:** `userAgent` in config not used.

**Steps:**
- [ ] Check if `agent-browser` supports user agent
- [ ] If yes, wire through the config
- [ ] If no, document limitation
- [ ] Add test for custom user agent

---

### 18. Add Custom Headers Support

**Files:** All providers

**Issue:** No way to pass custom headers (auth tokens, etc.).

**Steps:**
- [ ] Add `headers` to `ProviderConfig`
- [ ] Wire through to each provider
- [ ] Document security considerations
- [ ] Add test for header injection

---

### 19. Add Documentation

**Files:** Create `docs/PROVIDERS.md`

**Content:**
- [ ] Architecture diagram
- [ ] Provider selection flowchart
- [ ] Configuration options
- [ ] Troubleshooting guide
- [ ] Performance characteristics
- [ ] Security model

---

## Removed / Won't Fix

| Item | Reason |
|------|--------|
| ~~Public API versioning~~ | Interface is internal only |
| ~~Cookie jar support~~ | Not a current requirement |
| ~~Streaming responses~~ | Not applicable to markdown conversion |

---

## Completed

- [x] ~~Add bot protection capability flag~~ (declared but not implemented - see #11)
- [x] ~~Add Reddit RSS fast path~~ (declared in ClawfetchProvider)
- [x] ~~Add GitHub structured data~~ (GhCliProvider implemented, needs tests - see #2)

---

## Dependencies

```bash
# Before starting, ensure baseline:
npm test        # Should pass (currently 10 failures - see #1)
npm run lint    # Should pass
npm run typecheck # Should pass
```

---

## Priority Order (Recommended)

```
1.  #1  Fix tests (unblock everything)
2.  #2  GhCliProvider tests (confidence in GitHub URLs)
3.  #3  Fallback chain tests (confidence in resilience)
4.  #9  Real URL regression suite (verify goal met)
5.  #4  Resource cleanup (prevent leaks)
5.  #6  GhCliProvider complete (all GitHub types)
7.  #5  Consolidate detection (reduce duplication)
8.  #8  Better errors (DX improvement)
9.  #12 Security hardening
10. #7  Re-auth check (GhCli reliability)
... rest as time permits
```

---

## Notes

- Root cause of #1 is unknown - investigate before assuming turndown issue
- GhCliProvider needs full GitHub coverage (discussions, releases, commits, gists)
- Success = real URL regression suite passing (not just unit tests)
- Security review needed for token storage and content sanitization
- Concurrency model needs investigation before parallelizing fetches
