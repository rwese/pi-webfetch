---
name: Fixtures
description: HTTP response fixtures for regression testing
---

# HTML Fixtures

Store raw HTTP responses for offline regression testing.

## Structure

```
test/fixtures/
├── _collect.sh          # Collection script
├── _collect.py          # JSON builder
├── index.ts            # TypeScript loader
├── README.md            # This file
└── gni-pi-coding-agent-container/   # Per-fixture directory
    ├── response.json    # Status, headers, body file ref
    └── body.raw          # Raw response body
```

## Collecting a Fixture

```bash
./test/fixtures/_collect.sh "https://example.com/page" my-page
```

Creates:
```
test/fixtures/my-page/
├── response.json
└── body.raw
```

## response.json Format

```json
{
  "url": "https://example.com/page",
  "method": "GET",
  "fetchedAt": "2024-01-15T10:30:00Z",
  "provider": "default",
  "status": 200,
  "contentType": "text/html; charset=utf-8",
  "contentEncoding": "html",
  "headers": {
    "server": "nginx",
    "content-type": "text/html",
    ...
  },
  "bodyFile": "body.raw"
}
```

## Using in Tests

```typescript
import { loadFixture, listFixtures } from "./fixtures/index";

// Load a specific fixture
const fixture = loadFixture("gni-pi-coding-agent-container");
console.log(fixture.url);     // "https://github.com/..."
console.log(fixture.status);   // 200
console.log(fixture.headers);  // All headers
console.log(fixture.body);     // Raw HTML

// Process through webfetch
const result = await processFixture("my-page", convertToMarkdown);

// List all fixtures
const names = listFixtures();
```

## Guidelines

- Use descriptive directory names
- `_` prefix directories are ignored by loader
- Body stored as-is (raw, no processing)

## Inline HTML fixtures (slices)

Some tests need a small HTML slice (e.g. one or two
elements) rather than a full HTTP response. Place the
slice as a top-level `<name>.html` file in this
directory. The vitest test reads it directly via
`readFileSync(join(__dirname, 'fixtures', '<name>.html'))`.

Example: `wikipedia-pi-math.html` is a slice of the
Wikipedia `Pi` article containing two inline MathJax
formula spans. It backs the regression test in
`test/wikipedia-math-cleanup.test.ts`
([BUG-2026-06-06-JGCMZSOB-YZOYE](../../../docs/bugs/BUG-2026-06-06-JGCMZSOB-YZOYE.md)).
