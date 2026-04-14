# Link Nest Roadmap

Last updated: 2026-04-14

This roadmap is based on the current codebase, current product shape, and the gaps that matter most for usefulness.

It is intentionally opinionated. The goal is not to list every possible feature. The goal is to prioritize what will make Link Nest better fastest.

## Product direction

Link Nest is strongest as:

- a private personal link library
- a cleaner alternative to browser bookmarks
- a backend-first app that can later support mobile clients

That means the roadmap should favor:

- knowledge retention
- revisit workflow
- better organization
- backend durability
- future client readiness

Not random feature bloat.

## Current product strengths

Already implemented:

- private login for the website
- token auth for mobile or external clients
- add, edit, delete, restore, and hard delete
- tags, status, pinning, search, sort, pagination
- title fetching
- import and export
- bookmarks HTML import
- unread badge and stats
- link health checking
- basic PWA behavior
- security-aware URL validation and login rate limiting

This is already a solid base.

## Main product gaps

The biggest missing pieces are:

- no notes or personal context on saved links
- no saved views or smart organization layer beyond tags
- no duplicate detection workflow beyond exact URL conflict
- no revisit/reminder workflow
- no per-link reading history or interaction history
- no tests
- no dedicated mobile-facing polish despite mobile-ready auth

## Priority levels

### P0 = highest value next
### P1 = strong next phase
### P2 = valuable later
### P3 = optional or speculative

## P0: Highest-value next work

### 1. Add notes to links

Why it matters:

Bookmarks without notes become a graveyard.

The most valuable improvement is letting each saved link answer:

- why did I save this?
- what is useful about it?
- what should I remember later?

Suggested changes:

- add `notes` field to the link model
- show notes in editor page
- show note preview in browse rows or detail view
- include notes in search
- include notes in export/import

Why this is first:

It upgrades Link Nest from “bookmark storage” to “personal knowledge capture”.

### 2. Add saved views

Why it matters:

Right now filtering is useful, but temporary.

Saved views would let users create persistent shortcuts like:

- Unread articles
- Security links
- Videos to watch
- This week
- Research backlog

Suggested changes:

- create a `saved_views` collection or config object
- each view stores query params like `status`, `tag`, `q`, `sort`
- add UI for saving and loading views

Why this is high value:

It turns the app from a flat list into a repeatable workflow tool.

### 3. Add duplicate detection beyond exact URL match

Why it matters:

Exact URL conflict is good, but weak.

Real duplicates often differ by:

- tracking params
n- mobile vs desktop host
- trailing slash
- alternate canonical URLs
- same content with slightly different title/source form

Suggested changes:

- stronger normalization rules
- optional duplicate suggestions by host + similar title
- merge or review UI

Why it matters:

A personal library gets messy fast if duplicates pile up.

## P1: Strong next phase

### 4. Add reminder and revisit workflow

Examples:

- remind me in 3 days
- revisit next week
- surface stale unread links
- review useful links not opened recently

Possible model fields:

- `remindAt`
- `lastOpenedAt`
- `openedCount`
- `reviewState`

Why this matters:

The product should help users return to links, not just collect them.

### 5. Add richer metadata capture

Current metadata is mostly:

- title
- host

Good next metadata:

- description
- favicon
- site name
- thumbnail when available
- content type
- detected media type such as article, video, tweet, docs

Why this matters:

Better metadata improves scanability and organization.

### 6. Add a dedicated single-link API

Suggested endpoint:

```text
GET /api/links/:id
```

Why it matters:

The current editor loads all links and finds one client-side. That is wasteful and will age badly.

This is a small backend improvement with immediate cleanliness benefits.

### 7. Add tests for core backend behavior

Highest-value test targets:

- auth session flow
- token and refresh flow
- URL normalization
- SSRF protection
- link sanitization
- duplicate handling
- query parsing
- import logic

Why this matters:

The backend now has enough logic that silent regressions are a real risk.

## P2: Valuable later

### 8. Add collections or folders

Tags are flexible, but collections give stronger structure.

Examples:

- backend
- security
- startup ideas
- design references

This should not replace tags. It should complement them.

### 9. Add activity history

Track important events like:

- created
- updated
- restored
- opened
- status changed

Why useful:

- helps understand stale vs active links
- supports future reminder and review features

### 10. Add better import quality

Possible improvements:

- async background import progress
- preview before import
- duplicate summary after import
- import from JSON export file without manual shaping

### 11. Add API tokens or scoped integration support

If Link Nest grows into a personal platform, scoped tokens could support:

- iOS shortcuts
- browser extension
- automation scripts
- read-only integrations

## P3: Optional later ideas

### 12. Browser extension

Useful, but only after the backend and core UX are stronger.

### 13. AI-assisted tagging or summarization

Can be useful, but should come after notes and saved views.

Without strong manual structure first, AI features become decoration.

### 14. Shared libraries or multi-user support

Possible future direction, but it changes the product a lot.

It adds complexity in:

- permissions
- sharing model
- roles
- audit logging

This should stay low priority unless collaboration becomes a real product goal.

## Recommended implementation order

If you want the best next sequence, do this:

### Phase 1

1. add `notes`
2. add search support for notes
3. expose notes in UI and export/import

### Phase 2

4. add saved views
5. add `GET /api/links/:id`
6. refactor browse/editor data loading slightly

### Phase 3

7. add reminder and revisit fields
8. add stale/unread review views
9. add `lastOpenedAt` tracking

### Phase 4

10. improve duplicate detection
11. improve metadata extraction
12. add tests around the growing backend

## Technical roadmap alongside product roadmap

The product work should be paired with backend cleanup.

### Short-term technical improvements

- split `router.js` into route modules
- reduce full-document updates for tiny UI actions
- add test coverage around core utilities and auth
- add `GET /api/links/:id`

### Medium-term technical improvements

- separate `links.js` into read/write/import modules
- add structured error helpers
- improve import performance for large batches
- document mobile client expectations clearly

## What not to prioritize yet

These are tempting, but not the best next use of time:

- rewriting the frontend in a heavy framework
- multi-user collaboration
- complex social features
- AI features before notes exist
- deep design polish before product workflow improves

## Best next feature

If only one thing should be built next, it should be:

**Notes on links.**

Reason:

- biggest jump in product usefulness
- small enough to implement without destabilizing the app
- improves search, memory, and revisit quality
- makes Link Nest more than a bookmark list

## Summary

The roadmap should optimize for one outcome:

**turn Link Nest into a personal knowledge library, not just a bookmark storage app.**

The best path there is:

1. notes
2. saved views
3. revisit workflow
4. duplicate control
5. metadata depth
6. stronger tests and route structure
