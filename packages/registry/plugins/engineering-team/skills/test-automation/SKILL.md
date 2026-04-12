---
name: test-automation
description: Test automation patterns for Node.js/TypeScript projects. Use when writing or reviewing tests.
tags: [testing, automation, vitest, jest]
---

## Test Automation Patterns

### Test Structure (AAA)
```typescript
it("should create a user with valid input", async () => {
  // Arrange
  const input = { name: "Alice", email: "alice@example.com" };

  // Act
  const result = await createUser(input);

  // Assert
  expect(result.name).toBe("Alice");
  expect(result.id).toBeDefined();
});
```

### Naming Convention
- Describe what the function does, not how
- `it("should return 404 when user not found")`
- `it("should hash password before saving")`
- Group related tests with `describe`

### Mocking
- Mock at boundaries (database, HTTP, file system)
- Use `vi.mock()` or `jest.mock()` for module mocks
- Use `vi.fn()` for inline mocks
- Restore mocks after each test: `afterEach(() => vi.restoreAllMocks())`

### Assertions
- Assert specific values, not just truthiness
- Use `toEqual` for objects, `toBe` for primitives
- Test error messages: `expect(fn).toThrow("specific message")`
- Test async rejections: `await expect(fn()).rejects.toThrow()`

### Coverage
- Aim for 80%+ on critical paths (auth, data access, business logic)
- Don't test trivial getters/setters
- Cover error paths and edge cases
- Integration tests for API endpoint flows
