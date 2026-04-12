---
name: security-review
description: Security review checklist for code changes. Use when reviewing auth, data handling, or API endpoints.
tags: [security, review, owasp, auth]
---

## Security Review Checklist

### Authentication & Authorization
- Verify all endpoints require authentication (unless explicitly public)
- Check authorization — users can only access their own resources
- Validate JWT tokens on every request — don't trust client-side checks
- Use constant-time comparison for secrets and tokens

### Input Validation
- All user input is validated before processing
- SQL queries use parameterized queries — never string concatenation
- HTML output is escaped to prevent XSS
- File uploads validate type, size, and content
- URL parameters are validated and sanitized

### Data Protection
- Passwords are hashed with bcrypt (cost factor ≥ 12)
- Sensitive data is not logged (passwords, tokens, PII)
- API responses exclude sensitive fields (password hashes, internal IDs)
- Use HTTPS for all external communications

### Error Handling
- Internal error details are never exposed to clients
- Stack traces are logged server-side, not returned in responses
- Failed auth attempts return generic "invalid credentials" messages
- Rate limiting on auth endpoints to prevent brute force

### Dependencies
- No known vulnerabilities in dependencies (`bun audit`)
- Dependencies are pinned to specific versions
- Unused dependencies are removed
