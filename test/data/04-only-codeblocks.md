# Code Blocks Test

## TypeScript Examples

```typescript
// Generic types
function identity<T>(arg: T): T {
	return arg;
}

// Async/await
async function fetchData(url: string): Promise<Response> {
	const response = await fetch(url);
	return response.json();
}

// Classes with decorators
class Greeter {
	@logged
	greet(name: string): string {
		return `Hello, ${name}!`;
	}
}
```

## Python Examples

```python
# List comprehension
squares = [x**2 for x in range(10)]

# Context managers
with open('file.txt', 'r') as f:
    content = f.read()

# Decorators
@retry(max_attempts=3)
def unreliable_call():
    pass

# f-strings with expressions
result = f"Sum: {a + b}, Product: {a * b}"
```

## Bash Examples

```bash
# Conditionals
if [ -f "$file" ]; then
    echo "File exists"
elif [ -d "$dir" ]; then
    echo "It's a directory"
else
    echo "Not found"
fi

# Arrays
colors=(red green blue)
for color in "${colors[@]}"; do
    echo "$color"
done

# Pipes and redirects
grep -r "pattern" src/ > results.log 2>&1

# Arithmetic
result=$((a + b * c))
```

## Go Examples

```go
package main

import "fmt"

func main() {
    // Slices and maps
    m := make(map[string]int)
    m["key"] = 42

    // Goroutines
    go func() {
        fmt.Println("Running in goroutine")
    }()

    // Defer
    defer fmt.Println("Cleanup")
}
```

## JSON Example

```json
{
	"name": "test",
	"values": [1, 2, 3],
	"nested": {
		"key": "value"
	}
}
```

## SQL Example

```sql
SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at > '2024-01-01'
GROUP BY u.id, u.name
HAVING COUNT(o.id) > 5
ORDER BY order_count DESC;
```
