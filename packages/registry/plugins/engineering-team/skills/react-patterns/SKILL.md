---
name: react-patterns
description: Modern React patterns and best practices. Use when building or reviewing React components.
tags: [react, frontend, patterns, hooks]
---

## React Patterns

### Component Structure
- Functional components only — no class components
- Props interface defined above component
- Destructure props in function signature
- Export as named export (not default)

### State Management
- Use `useState` for local state
- Use `useReducer` for complex state transitions
- All state updates must be **immutable**:
  ```typescript
  // ✅ Correct
  setItems(prev => [...prev, newItem]);
  setUser(prev => ({ ...prev, name: newName }));

  // ❌ Wrong — mutates state
  items.push(newItem);
  user.name = newName;
  ```

### Effects
- `useEffect` for side effects (API calls, subscriptions)
- Always specify dependency array
- Return cleanup function for subscriptions
- Avoid effects for derived state — use `useMemo` instead

### Custom Hooks
- Extract reusable logic into `use*` hooks
- One hook per concern
- Return object for 3+ values: `{ data, loading, error }`

### Performance
- `React.memo` only when profiling shows re-render issues
- `useCallback` for callbacks passed to memoized children
- `useMemo` for expensive computations
- Avoid premature optimization

### Error Boundaries
- Wrap major sections in error boundaries
- Show fallback UI — never blank screens
- Log errors to monitoring service
