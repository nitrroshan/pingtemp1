---
name: api-design
description: REST API design patterns and conventions. Use when designing endpoints or reviewing API consistency.
tags: [api, rest, design, http]
---

## API Design Conventions

### URL Structure
- Use plural nouns for resources: `/users`, `/teams`, `/agents`
- Use kebab-case for multi-word resources: `/agent-skills`
- Nest related resources: `/teams/:id/agents`
- Use query params for filtering: `?status=active&limit=10`

### HTTP Methods
- `GET` — Read (no side effects)
- `POST` — Create new resource
- `PUT` — Full replace
- `PATCH` — Partial update
- `DELETE` — Remove

### Response Format
```json
{
  "data": {},
  "error": null,
  "meta": { "total": 100, "page": 1 }
}
```

### Error Responses
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": [{ "field": "email", "issue": "Invalid format" }]
  }
}
```

### Status Codes
- `200` — Success
- `201` — Created
- `400` — Bad request (validation error)
- `401` — Unauthorized
- `403` — Forbidden
- `404` — Not found
- `409` — Conflict
- `500` — Internal server error

### Input Validation
- Validate all input with Zod schemas
- Return 400 with field-level error details
- Never trust client-provided IDs for authorization
