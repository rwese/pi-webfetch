# Complete Test Document

This document contains all supported markdown elements for testing.

## Links Section

Visit [Example Website](https://example.com) for more info.

Check our [FAQ section](#faq) below.

External reference to [GitHub](https://github.com).

## Anchors

Some content with [](#internal-anchor) empty anchor links that should be removed.

More text with [](#another-anchor) another anchor.

## Embedded Images

Here's a small embedded image:

![logo](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)

And another one with alt text:

![Screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg== 'Optional title')

## External Images

Regular external images that should also be extracted:

![External Image 1](https://example.com/images/screenshot.png)

![External Image 2](https://example.com/images/diagram.svg 'Architecture Diagram')

## Code Blocks

### TypeScript

```typescript
interface User {
	id: number;
	name: string;
	email: string;
}

function greet(user: User): string {
	return `Hello, ${user.name}!`;
}

const user: User = { id: 1, name: 'Alice', email: 'alice@example.com' };
console.log(greet(user));
```

### Python

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class User:
    id: int
    name: str
    email: str

    def greet(self) -> str:
        return f"Hello, {self.name}!"

def find_user(users: List[User], user_id: int) -> Optional[User]:
    return next((u for u in users if u.id == user_id), None)

users = [User(1, "Alice", "alice@example.com"), User(2, "Bob", "bob@example.com")]
user = find_user(users, 1)
if user:
    print(user.greet())
```

### Bash

```bash
#!/bin/bash

# Comment in bash
for i in {1..5}; do
    echo "Iteration $i"
done

# Function definition
get_timestamp() {
    date +"%Y-%m-%d %H:%M:%S"
}

# Variable assignment
NAME="World"
echo "Hello, $NAME!"

# Command substitution
CURRENT_DIR=$(pwd)
echo "Current directory: $CURRENT_DIR"
```

## FAQ Section {#faq}

This section has an anchor ID.

- Item 1 with [link](https://example.com/1)
- Item 2 with [link](https://example.com/2)
- Item 3

## Nested Content

Before table:

| Column A | Column B |
| -------- | -------- |
| Cell 1   | Cell 2   |

After table with [](#footer-anchor) footer anchor.

---

## Footer {#footer-anchor}

End of document.
