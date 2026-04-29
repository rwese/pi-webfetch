---
id: example-com
url: https://example.com
reportedAt: 2026-04-29T11:40:00Z
issue: Simple HTML page - basic fetch test
provider: default
tags: [simple, html, basic]
status: passing
---

```expected
# Example Domain

This domain is for use in documentation examples without needing permission. Avoid use in operations.

[Learn more](https://iana.org/domains/example)
```

```actual
# Example Domain

This domain is for use in documentation examples without needing permission. Avoid use in operations.

[Learn more](https://iana.org/domains/example)
```

```assertions
contains: # Example Domain
contains: This domain is for use in documentation examples
contains: iana.org/domains/example
has_lines: > 2
has_lines: < 20
```
