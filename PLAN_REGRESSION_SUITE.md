# Plan: Real URL Regression Suite

## Goal
**Can fetch any URL reliably. Real URL regression suite passing.**

---

## Current State

- **Existing cases:** 1 (GitHub directory listing - passing)
- **Framework:** ✅ Implemented (`test/cases/`, `run-regression.test.ts`)
- **Scripts:** ✅ `npm run test:regression`, `npm run report-url`

---

## URL Types to Cover

| Category | Provider | URL Examples | Priority |
|----------|----------|-------------|----------|
| GitHub Issues | gh-cli | `.../issues/123` | High |
| GitHub PRs | gh-cli | `.../pull/456` | High |
| GitHub Repos | gh-cli | `.../owner/repo` | High |
| GitHub Directory | default/clawfetch | `.../tree/main/src` | Medium |
| GitHub Raw Files | default | `raw.githubusercontent.com/...` | Medium |
| Reddit Posts | clawfetch | `reddit.com/r/.../comments/...` | Medium |
| Simple HTML | default | `example.com`, `wikipedia.org` | High |
| SPAs | clawfetch | `notion.so`, `linear.app` | Medium |
| Binary Files | default | PDFs, images | Low |
| Error Cases | N/A | 404s, blocked sites | Low |

---

## Implementation Steps

### Phase 1: Core GitHub Coverage (High Priority)

**1.1 Add GitHub Issue Test Case**
```bash
npm run report-url -- \
  --url "https://github.com/nodejs/node/issues/1" \
  --issue "GitHub issue with comments and labels"
```

**1.2 Add GitHub PR Test Case**
```bash
npm run report-url -- \
  --url "https://github.com/nodejs/node/pull/1" \
  --issue "GitHub PR with code review"
```

**1.3 Add GitHub Repo Test Case**
```bash
npm run report-url -- \
  --url "https://github.com/microsoft/vscode" \
  --issue "GitHub repo with metadata"
```

### Phase 2: Other Providers (Medium Priority)

**2.1 Add Reddit Post Test Case**
```bash
npm run report-url -- \
  --url "https://www.reddit.com/r/programming/comments/example" \
  --issue "Reddit post with comments"
```

**2.2 Add Simple HTML Test Case**
```bash
npm run report-url -- \
  --url "https://example.com" \
  --issue "Simple HTML page"
```

**2.3 Add SPA Test Case (if clawfetch available)**
```bash
npm run report-url -- \
  --url "https://example.notion.so/workspace" \
  --issue "SPA rendered page"
```

### Phase 3: Edge Cases (Lower Priority)

**3.1 Add 404 Test Case**
```bash
npm run report-url -- \
  --url "https://example.com/nonexistent-page-12345" \
  --issue "Page not found handling"
```

**3.2 Add Raw File Test Case**
```bash
npm run report-url -- \
  --url "https://raw.githubusercontent.com/..." \
  --issue "Raw file download"
```

---

## Workflow

### Adding a New Case

```bash
# 1. Report a URL with issue description
npm run report-url -- \
  --url "https://github.com/user/repo/issues/123" \
  --issue "Brief description of what's broken or needs verification"

# 2. Fetch and capture actual output
# (manual step - fetch the URL and paste output)

# 3. Define expected output
# (edit the generated .md file, add expected content)

# 4. Add assertions
# (optional - add assertions block for specific checks)

# 5. Mark as passing once verified
npm run report-url -- \
  --update <case-id> \
  --status passing
```

### Running Tests

```bash
# Run all regression tests
npm run test:regression

# Watch mode
npm run test:regression:watch

# List all cases
npm run report-url -- --list

# List by status
npm run report-url -- --list --status_filter pending
```

---

## Target Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Total cases | 1 | 15+ |
| Passing cases | 1 | 12+ |
| URL type coverage | 1/10 | 8/10 |
| Providers covered | 1/3 | 3/3 |

---

## Acceptance Criteria

- [ ] 15+ regression test cases added
- [ ] All major URL types covered
- [ ] All three providers (default, clawfetch, gh-cli) have at least one passing test
- [ ] `npm run test:regression` passes with 80%+ pass rate
- [ ] Each case has meaningful assertions
- [ ] Documentation updated in AGENTS.md

---

## Files to Modify

1. `test/cases/` - Add new .md case files
2. `AGENTS.md` - Update regression test documentation
3. `README.md` - Add regression suite badge/section (optional)

---

## Notes

- Cases should use stable, well-known URLs (e.g., nodejs/node, microsoft/vscode)
- Avoid URLs that change frequently or require authentication
- For GitHub, prefer issues/PRs with numbers 1-100 (historical, stable)
- Include variety: different content types, lengths, languages
