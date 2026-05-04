# SOLID Principles Code Review - TODO List

## Summary

Reviewed codebase for SOLID principles violations. Key findings:

| Principle | Status | Files Affected |
|-----------|--------|----------------|
| SRP | 🔴 Needs Work | 5 files |
| OCP | 🟠 Needs Work | 3 locations |
| LSP | 🟡 Minor Issues | 2 locations |
| ISP | 🟠 Needs Work | 3 interfaces |
| DIP | 🔴 Needs Work | 3 locations |

---

## HIGH Priority

### 1. Split `extensions/index.ts` (SRP)

**Issue:** 470+ lines, mixes tool registration, command registration, type definitions, message renderers.

**Tasks:**

```markdown
- [ ] Create `extensions/tools/webfetch.ts` - webfetch tool registration
- [ ] Create `extensions/tools/webfetch-spa.ts` - webfetch-spa tool
- [ ] Create `extensions/tools/download-file.ts` - download tool
- [ ] Create `extensions/tools/webfetch-providers.ts` - provider status tool
- [ ] Create `extensions/commands/` directory with command handlers
- [ ] Move type exports to `extensions/types.ts`
- [ ] Move `webfetchResultRenderer` to `extensions/message-renderers.ts`
- [ ] Update `extensions/index.ts` to re-export and compose
```

**Files to create:**
- `extensions/tools/`
- `extensions/commands/`

---

### 2. Extract duplicated `execAsync` to shared utility (DRY + DIP)

**Issue:** `execAsync` duplicated in `default.ts`, `clawfetch.ts`, `gh-cli.ts`.

**Tasks:**

```markdown
- [ ] Create `src/utils/process.ts`
- [ ] Implement shared `execAsync()` with proper typing
- [ ] Remove `execAsync` from `src/providers/default.ts`
- [ ] Remove `execAsync` from `src/providers/clawfetch.ts`
- [ ] Remove `execAsync` from `src/providers/gh-cli.ts`
```

**Files to create:**
- `src/utils/process.ts`

---

### 3. Unify `isAvailable()` return type (LSP)

**Issue:** Returns `boolean | Promise<boolean>` inconsistently.

**Tasks:**

```markdown
- [ ] Standardize all providers to return `Promise<boolean>`
- [ ] Update `WebfetchProvider` interface type
- [ ] Update `ProviderManager.isProviderAvailable()` accordingly
```

---

## MEDIUM Priority

### 4. Split `extensions/helpers.ts` (SRP)

**Issue:** Mixed formatting, URL utilities, phase constants, labels.

**Tasks:**

```markdown
- [ ] Create `extensions/utils/formatting.ts` - formatBytes, truncateToSize, getTempFilePath
- [ ] Create `extensions/utils/url.ts` - URL utilities, parseUrlForDisplay, convertGitHubToRaw, isLikelyBinaryUrl
- [ ] Create `extensions/fetch-phases.ts` - FetchPhase type, FETCH_PHASE_LABELS, getCommandPhaseLabel
- [ ] Update imports in dependent files
```

**Files to create:**
- `extensions/utils/`
- `extensions/fetch-phases.ts`

---

### 5. Split `extensions/fetch.ts` (SRP)

**Issue:** 400+ lines handling caching, provider management, main fetch, binary handling, streaming.

**Tasks:**

```markdown
- [ ] Create `extensions/services/fetch-service.ts` - main orchestration (fetchUrl, webfetchResearch)
- [ ] Create `extensions/services/static-fetch.ts` - static HTTP fetch logic
- [ ] Create `extensions/services/cache-service.ts` - caching logic (setCache, getCache, shouldSkipCache)
- [ ] Create `extensions/services/provider-manager.ts` - session-scoped manager
- [ ] Update imports and exports in `extensions/index.ts`
```

**Files to create:**
- `extensions/services/`

---

### 6. Split `src/providers/default.ts` (SRP)

**Issue:** Browser management, extraction, timeout, markdown conversion, URL detection all in one class.

**Tasks:**

```markdown
- [ ] Create `BrowserManager` class - browser lifecycle (open, close, mutex, idle timeout)
- [ ] Extract `TurndownService` configuration to separate file
- [ ] Create URL detection utilities
- [ ] Refactor `DefaultProvider` to use composed dependencies
```

**Files to create:**
- `src/providers/browser-manager.ts`
- `src/providers/turndown-config.ts`

---

### 7. Split `src/providers/gh-cli.ts` (SRP)

**Issue:** URL parsing, multiple fetch types (issue, pr, repo, tree, blob), file type detection, icons all in one class.

**Tasks:**

```markdown
- [ ] Create `GitHubUrlParser` - URL parsing logic
- [ ] Create `GitHubContentFetcher` - gh API abstraction
- [ ] Create `FileTypeDetector` - file type utilities, icons
- [ ] Refactor `GhCliProvider` to use composed dependencies
```

**Files to create:**
- `src/providers/github-url-parser.ts`
- `src/providers/file-type-detector.ts`

---

## LOW Priority

### 8. Make `ProviderCapabilities` optional per-provider (ISP)

**Issue:** Forces all capability properties even if not applicable.

**Tasks:**

```markdown
- [ ] Consider using `Partial<ProviderCapabilities>` or
- [ ] Create capability groups: `BrowserCapabilities`, `ApiCapabilities`
```

---

### 9. Add `FetchMethod` strategy pattern (OCP)

**Issue:** Hardcoded static fallback; adding new fetch methods requires editing.

**Tasks:**

```markdown
- [ ] Create `FetchMethod` interface
- [ ] Implement `StaticFetchMethod`, `ProviderFetchMethod`, etc.
- [ ] Allow adding methods via composition
```

---

### 10. Dependency injection for `ProviderManager` (DIP)

**Issue:** Direct instantiation in `fetch.ts`.

**Tasks:**

```markdown
- [ ] Accept providers via constructor injection
- [ ] Allow test doubles / mocks
- [ ] Consider factory pattern for session-scoped managers
```

---

### 11. Extract binary type detection to configuration (OCP)

**Issue:** `BINARY_EXTENSIONS` hardcoded in multiple places.

**Tasks:**

```markdown
- [ ] Create `src/config/binary-types.ts`
- [ ] Create `src/config/content-types.ts`
- [ ] Share across providers instead of duplication
```

**Files to create:**
- `src/config/`

---

## File Structure After Refactoring

```
extensions/
├── index.ts                    # Re-exports and main setup
├── types.ts                   # Shared types
├── tools/                     # NEW: Tool registrations
│   ├── webfetch.ts
│   ├── webfetch-spa.ts
│   ├── download-file.ts
│   └── webfetch-providers.ts
├── commands/                  # NEW: Command handlers
│   ├── webfetch-command.ts
│   ├── webfetch-status-command.ts
│   └── webfetch-info-command.ts
├── services/                  # NEW: Service layer
│   ├── fetch-service.ts
│   ├── static-fetch.ts
│   └── cache-service.ts
├── utils/                     # NEW: Utilities
│   ├── formatting.ts
│   └── url.ts
├── fetch-phases.ts            # NEW: Phase constants
├── content-types.ts
├── html.ts
├── markdown.ts
├── cache.ts
├── pi-agent.ts
└── message-renderers.ts

src/
├── providers/
│   ├── index.ts
│   ├── types.ts
│   ├── manager.ts
│   ├── default.ts
│   ├── clawfetch.ts
│   ├── gh-cli.ts
│   ├── browser-manager.ts     # NEW
│   ├── turndown-config.ts     # NEW
│   ├── github-url-parser.ts   # NEW
│   └── file-type-detector.ts  # NEW
├── utils/
│   └── process.ts             # NEW: Shared execAsync
└── config/
    ├── binary-types.ts        # NEW
    └── content-types.ts       # NEW
```

---

## Verification Checklist

After refactoring, verify:

```markdown
- [ ] All tests pass: `npm test`
- [ ] Linter passes: `npm run lint`
- [ ] Type check passes: `npm run typecheck`
- [ ] Extension loads correctly: `pi -e . --offline -p test`
```

---

## Notes

- **Breaking Changes:** Refactoring may introduce breaking changes to the public API
- **Version Bump:** Consider semver bump (major) after SRP/ISP changes
- **Test Coverage:** Add unit tests for new extracted modules before refactoring
