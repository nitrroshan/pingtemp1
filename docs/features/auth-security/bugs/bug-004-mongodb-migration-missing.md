# Bug: MongoDB sessionId→userId migration missing

**Feature:** `auth-security` Phase 1 Step 8 (sessionId→userId rename)

**Symptom:** New messages not saving in cloud mode (MongoDB). Old messages load but with fallback userId. Goal saves may fail silently. Second browser shows stale data.

**Root Cause:** 
The `sessionId→userId` rename was done in:
- ✅ TypeScript types (`ChatMessage.ts`, `Goal.ts`)
- ✅ Mongoose schemas (`ChatMessageSchema.ts`, `GoalSchema.ts`) — field renamed to `userId: required: true`
- ✅ Mongoose services (`MongoChatService.ts`, `MongoGoalService.ts`) — read fallback `doc.userId ?? doc.sessionId`
- ✅ SQLite (`ALTER TABLE RENAME COLUMN sessionId TO userId`) — auto-migrates on startup
- ❌ **MongoDB documents NOT migrated** — 139 documents still have `sessionId` field, no `userId`

**Impact:**
- `addMessage()` fails Mongoose validation (`userId: required` but document written has `userId` which should work — BUT if any middleware or plugin strips it, validation fails)
- Mixed collection: some docs have `sessionId`, new docs have `userId` — queries by `userId` miss old docs
- `addGoal()` with `userId` field works for new docs, but `getGoals()` returns old docs with `sessionId` that get mapped via fallback

**Fix Type:** `fix` (permanent) — MongoDB migration script

**Fix:**
Run one-time MongoDB migration to rename the field on existing documents:

```javascript
// Connect to the ping database
use ping

// Rename sessionId → userId on chat messages
db.chatmessages.updateMany(
  { sessionId: { $exists: true }, userId: { $exists: false } },
  { $rename: { "sessionId": "userId" } }
)

// Rename sessionId → userId on goals
db.goals.updateMany(
  { sessionId: { $exists: true }, userId: { $exists: false } },
  { $rename: { "sessionId": "userId" } }
)

// Verify
db.chatmessages.countDocuments({ sessionId: { $exists: true } })  // should be 0
db.chatmessages.countDocuments({ userId: { $exists: true } })     // should be 139+
```

Or via Docker:
```bash
docker exec ping-mongo mongosh "mongodb://localhost:27017/ping" --eval '
  db.chatmessages.updateMany(
    { sessionId: { $exists: true }, userId: { $exists: false } },
    { $rename: { "sessionId": "userId" } }
  );
  db.goals.updateMany(
    { sessionId: { $exists: true }, userId: { $exists: false } },
    { $rename: { "sessionId": "userId" } }
  );
'
```

**Long-term:** Add an auto-migration to `MongoChatService` constructor (similar to SQLite's `ALTER TABLE` migrations) so this runs on startup.

**Verification:** After migration, `db.chatmessages.findOne()` should show `userId` field, not `sessionId`. New messages should save and load correctly across browsers.
