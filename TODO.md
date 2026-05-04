# SOLID Principles Implementation - TODO

## HIGH Priority

### 1. Split `extensions/index.ts` (SRP)
- [x] Create `extensions/tools/` directory
- [x] Create `extensions/tools/webfetch.ts` - webfetch tool registration
- [x] Create `extensions/tools/webfetch-spa.ts` - webfetch-spa tool
- [x] Create `extensions/tools/download-file.ts` - download tool
- [x] Create `extensions/tools/webfetch-providers.ts` - provider status tool
- [x] Create `extensions/tools/webfetch-cache.ts` - cache tools
- [x] Create `extensions/commands/` directory
- [x] Update `extensions/index.ts` to re-export and compose

### 2. Extract duplicated `execAsync` to shared utility (DRY + DIP)
- [x] Create `src/utils/process.ts`
- [x] Implement shared `execAsync()` with proper typing
- [x] Remove `execAsync` from `src/providers/default.ts`
- [x] Remove `execAsync` from `src/providers/clawfetch.ts`
- [x] Remove `execAsync` from `src/providers/gh-cli.ts`

### 3. Unify `isAvailable()` return type (LSP)
- [ ] Standardize all providers to return `Promise<boolean>`
- [ ] Update `WebfetchProvider` interface type
- [ ] Update `ProviderManager.isProviderAvailable()` accordingly

## MEDIUM Priority

### 4. Split `extensions/helpers.ts` (SRP)
- [ ] Create `extensions/utils/formatting.ts` - formatBytes, truncateToSize, getTempFilePath
- [ ] Create `extensions/utils/url.ts` - URL utilities
- [ ] Create `extensions/fetch-phases.ts` - FetchPhase type, labels
- [ ] Update imports in dependent files

### 5. Split `extensions/fetch.ts` (SRP)
- [ ] Create `extensions/services/fetch-service.ts` - main orchestration
- [ ] Create `extensions/services/static-fetch.ts` - static HTTP fetch
- [ ] Create `extensions/services/cache-service.ts` - caching logic
- [ ] Create `extensions/services/provider-manager.ts` - session-scoped manager
- [ ] Update imports and exports in `extensions/index.ts`

### 6. Split `src/providers/default.ts` (SRP)
- [ ] Create `BrowserManager` class
- [ ] Extract `TurndownService` configuration
- [ ] Create URL detection utilities
- [ ] Refactor `DefaultProvider` to use composed dependencies

### 7. Split `src/providers/gh-cli.ts` (SRP)
- [ ] Create `GitHubUrlParser`
- [ ] Create `GitHubContentFetcher`
- [ ] Create `FileTypeDetector`
- [ ] Refactor `GhCliProvider`

## LOW Priority

### 8. Make `ProviderCapabilities` optional per-provider (ISP)
- [ ] Consider using `Partial<ProviderCapabilities>` or
- [ ] Create capability groups

### 9. Add `FetchMethod` strategy pattern (OCP)
- [ ] Create `FetchMethod` interface
- [ ] Implement strategy classes

### 10. Dependency injection for `ProviderManager` (DIP)
- [ ] Accept providers via constructor injection
- [ ] Allow test doubles / mocks

### 11. Extract binary type detection to configuration (OCP)
- [ ] Create `src/config/binary-types.ts`
- [ ] Create `src/config/content-types.ts`
- [ ] Share across providers

## Verification

- [ ] All tests pass: `npm test`
- [ ] Linter passes: `npm run lint`
- [ ] Type check passes: `npm run typecheck`
- [ ] Extension loads correctly: `pi -e . --offline -p test`
