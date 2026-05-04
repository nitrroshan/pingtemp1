# Bug: Auth identity not threaded through system

**Feature:** `conversation-persistence` + `production-grade` (auth)

**Symptom:** All users share the same conversations. `sessionId: "default"` everywhere. No user isolation. Multi-user scenarios show each other's messages.

**Root Cause:** Five-layer identity gap:
1. Frontend: `useSession()` gives `user.id` but never passes it to services
2. `AgentServiceV2.userId`: random string, not from auth
3. Socket `register`: server accepts client-provided random userId, ignores auth cookie
4. HTTP `/api/v2/*`: zero auth middleware, no `req.user`
5. Chat/Goal services: `sessionId: "default"` hardcoded everywhere

**Fix Type:** `fix` (permanent) — v2.0 refactoring

**Changes:** Socket.IO middleware validates auth cookie → extracts `user.id`. HTTP middleware does same. `sessionId` replaced with real user identity. All services receive authenticated userId.

**Verification:** Two different users see separate conversations. Logout → conversations not visible to other users.
