# Task 009 — Discussion Info / Agenda / Decisions tabs

**Status:** ⏭️ Skipped — Discussion sub-tab exists (Messages only). Info/Agenda/Decisions deferred as UX polish.  
**Phase:** 6 · **Risk:** High · **Depends on:** task-006, task-008

## Goal
Wrap `DiscussionMessages` in a tabbed container so the Discussion tab in DetailPanel exposes 4 sub-tabs: **Messages | Info | Agenda | Decisions**.

## Files
- **EDIT** `packages/frontend/components/DiscussionThread/DiscussionThread.tsx` — becomes the tabs wrapper
- **NEW** `packages/frontend/components/DiscussionThread/DiscussionInfo.tsx`
- **NEW** `packages/frontend/components/DiscussionThread/DiscussionAgenda.tsx`
- **NEW** `packages/frontend/components/DiscussionThread/DiscussionDecisions.tsx`
- **DELETE** old `StatusBar`, `ParticipantBar`, `AgendaBar` sub-components (content moved to tabs)

## DiscussionThread (new) contract
```tsx
type DiscussionThreadProps = {
  teamId: string;
  goalId: string;
  taskId: string;
  title: string;
};
```

Internally it calls `useDiscussion()` (existing hook), then renders:

```tsx
<TabBar size="sm" tabs={[Messages, Info, Agenda, Decisions]} ... />
{activeTab === 'messages' && <DiscussionMessages ... />}
{activeTab === 'info'     && <DiscussionInfo config={config} participants={participants} ... />}
{activeTab === 'agenda'   && <DiscussionAgenda agenda={config?.agenda ?? []} />}
{activeTab === 'decisions'&& <DiscussionDecisions decisions={decisions} />}
```

## Sub-tab contents

### Info tab
```
Status        🟢 Active
Started       <relative time>
Task          T-N · <title>
Plan          <plan name>

Participants
  🤖 backend     ✅ posted
  🤖 frontend    ✅ posted
  ...

Limits
  Rounds      X / maxRounds per agent
  Tokens      X / maxTokens
  Timeout     N min left

[Close discussion]   ← admin button (feature-gated)
```

### Agenda tab
```
Agenda  (X / N resolved)
  ☑ Endpoint shapes
  ☐ Auth token format
  ☐ Error response schema
```
Each item is read-only (resolved by agents posting `discuss decide` with item id).

### Decisions tab
```
For each decision in chronological order:
  ✅ <key>            <time>
  <markdown body>
  Agreed by: backend, frontend, qa
```

## Acceptance
- [ ] Discussion tab in DetailPanel shows TabBar + content
- [ ] Default active sub-tab: Messages
- [ ] Switching sub-tabs is instant (no CRDT reconnect)
- [ ] Old monolithic DiscussionThread layout fully replaced
- [ ] No regressions: posting still works, decisions render, mentions hyperlink
