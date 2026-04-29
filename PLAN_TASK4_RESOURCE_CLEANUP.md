# Plan: Task #4 - Resource Cleanup & Concurrency Fixes

## Overview

**Priority:** HIGH
**Goal:** Prevent resource leaks, handle concurrent requests safely, ensure proper cleanup

---

## Problems Identified

### 1. No `close()` Method Implementation
- `WebfetchProvider` interface has optional `close()` method
- Neither `DefaultProvider` nor `ClawfetchProvider` implement it
- Browser processes can leak if not explicitly closed

### 2. No Automatic Cleanup on Errors
- If `extractHtmlFromBrowser()` throws mid-execution, browser stays open
- No `finally` blocks to ensure cleanup

### 3. Synchronous Blocking (execFileSync)
- `DefaultProvider` uses `execFileSync` (blocking)
- Concurrent requests block Node.js event loop
- Could cause timeout issues under load

### 4. No Resource Pooling
- Each fetch creates new browser instance
- No way to limit concurrent browser instances
- Under high load: resource exhaustion

### 5. No Process Tracking
- Can't tell if browser processes are running
- No health monitoring for browser state

---

## Implementation Plan

### Phase 1: Add `close()` Implementation

**File:** `src/providers/default.ts`

```typescript
/**
 * Clean up browser resources
 */
async close(): Promise<void> {
  if (this.browserOpen) {
    try {
      execFileSync("agent-browser", ["close"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      // Ignore close errors
    }
    this.browserOpen = false;
  }
}
```

**File:** `src/providers/clawfetch.ts`

```typescript
/**
 * Clean up resources (clawfetch handles its own cleanup)
 */
async close(): Promise<void> {
  // clawfetch is stateless, nothing to clean up
}
```

**Add tracking flag:**
```typescript
private browserOpen = false;
```

---

### Phase 2: Add `finally` Blocks for Error Safety

**File:** `src/providers/default.ts`

Update `extractHtmlFromBrowser()`:

```typescript
private async extractHtmlFromBrowser(...): Promise<{...}> {
  let html = "";
  let contentSource = "body";

  try {
    // Open URL
    execFileSync("agent-browser", ["open", url], { ... });
    this.browserOpen = true;

    // Wait for load
    execFileSync("agent-browser", ["wait", "--load", waitFor], { ... });

    // Try article
    try { /* ... */ } catch { /* ... */ }

    // Try main
    if (!html) { /* ... */ }

    // Fallback to body
    if (!html || html.trim().length < 100) {
      html = execFileSync("agent-browser", ["get", "html", "body"], { ... });
      contentSource = "body";
    }

    return { html, contentSource };
  } finally {
    // ALWAYS close browser, even on error
    this.safeClose();
  }
}

private safeClose(): void {
  if (this.browserOpen) {
    try {
      execFileSync("agent-browser", ["close"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      // Ignore
    }
    this.browserOpen = false;
  }
}
```

Same pattern for `extractTextFromBrowser()`.

---

### Phase 3: Add Resource Manager (Optional - for future)

**File:** `src/providers/resource-manager.ts` (new)

```typescript
/**
 * Manages shared browser instances for better resource utilization.
 * Can limit concurrent browsers and reuse instances.
 */
export class ResourceManager {
  private maxInstances: number;
  private availableInstances: string[] = [];
  private inUseInstances: Set<string> = new Set();

  constructor(maxInstances = 5) {
    this.maxInstances = maxInstances;
  }

  async acquireInstance(): Promise<string> {
    // Implementation
  }

  async releaseInstance(instanceId: string): Promise<void> {
    // Implementation
  }

  async closeAll(): Promise<void> {
    // Close all instances
  }

  getStats() {
    return {
      available: this.availableInstances.length,
      inUse: this.inUseInstances.size,
      max: this.maxInstances,
    };
  }
}
```

**Note:** This is optional - adds complexity. Start without it.

---

### Phase 4: Add Tests

**File:** `test/resource-cleanup.test.ts` (new)

```typescript
describe("Resource Cleanup", () => {
  describe("DefaultProvider close()", () => {
    it("sets browserOpen to false after close", async () => {
      const provider = new DefaultProvider();
      provider.browserOpen = true;
      await provider.close();
      expect(provider.browserOpen).toBe(false);
    });

    it("handles close when browser already closed", async () => {
      const provider = new DefaultProvider();
      provider.browserOpen = false;
      await provider.close(); // Should not throw
      expect(provider.browserOpen).toBe(false);
    });
  });

  describe("Error safety", () => {
    it("closes browser even when extraction fails", async () => {
      const provider = new DefaultProvider();
      // Mock execFileSync to fail after open
      // Verify close was called
    });
  });
});
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/providers/default.ts` | Add `close()`, `safeClose()`, `browserOpen` flag, `finally` blocks |
| `src/providers/clawfetch.ts` | Add `close()` (no-op) |
| `src/providers/types.ts` | Document `close()` requirements |
| `test/resource-cleanup.test.ts` | Add cleanup tests (new) |

---

## Acceptance Criteria

- [ ] `DefaultProvider.close()` properly terminates browser
- [ ] Browser is closed even when extraction fails (finally block)
- [ ] `ClawfetchProvider.close()` is a no-op (stateless)
- [ ] Both providers implement the optional `close()` method
- [ ] Tests verify cleanup happens on error paths
- [ ] No browser processes left hanging after fetch errors
- [ ] `npm test` passes with new tests

---

## Notes

### Why not async/exec instead of execFileSync?

Changing from `execFileSync` to `exec` (async) would be a larger refactor. For now:
- Keep `execFileSync` for simplicity
- Focus on proper cleanup with `finally` blocks
- Document that providers are NOT thread-safe

### Future Improvements (Out of Scope)

1. **Resource pooling** - Share browser instances across requests
2. **Async exec** - Use `exec()` instead of `execFileSync()`
3. **Process monitoring** - Track zombie processes
4. **Health checks** - Verify browser is responsive

---

## Timeline

| Phase | Effort | Description |
|-------|--------|-------------|
| Phase 1 | 30 min | Add `close()` methods |
| Phase 2 | 45 min | Add `finally` blocks |
| Phase 3 | 1 hour | Add tests |
| **Total** | ~2.5 hours | |

---

## Verification Commands

```bash
# Run all tests
npm test

# Run specifically cleanup tests
npx vitest run test/resource-cleanup.test.ts

# Check for zombie processes (macOS/Linux)
ps aux | grep agent-browser

# Check lint/typecheck
npm run lint && npm run typecheck
```
