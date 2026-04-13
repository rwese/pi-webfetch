# pi-webfetch Extension

## Quality Gates

```bash
npm run ci
```

This runs all checks in sequence:
1. `check` - TypeScript type checking
2. `test:coverage` - Run tests with coverage report

## Extension Validation

Test that the extension compiles and loads correctly:

```bash
pi -e . --offline -p test
```

This validates the extension compiles and all imports resolve correctly.

## Development

```bash
npm run test        # Run tests once
npm run test:watch  # Watch mode
npm run test:coverage  # With coverage report
npm run check       # Type check only
```