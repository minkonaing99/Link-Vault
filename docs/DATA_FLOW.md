# Link Nest Data Flow

Last updated: 2026-04-14

This document explains how data moves through Link Nest during the main user actions.

It focuses on the real current code paths, not an idealized future design.

## Overview

Link Nest is a multi-page web app backed by a small Node.js HTTP server and MongoDB.

At a high level, most actions follow this pattern:

```text
Browser UI
  -> page script in public/js/
  -> HTTP request to /api/...
  -> lib/router.js
  -> auth check if needed
  -> domain logic in lib/auth.js or lib/links.js
  -> MongoDB
  -> JSON response
  -> UI re-render in browser
```

## Main request layers

### Frontend

The frontend is split by page:

- `public/js/home.js`
- `public/js/browse.js`
- `public/js/editor.js`
- `public/js/archive.js`
- `public/js/login.js`
- `public/js/shared.js`

These scripts collect user input, call the API, and update the DOM.

### Routing layer

`lib/router.js` receives each request and decides:

- which route matches
- whether auth is required
- which domain function to call
- how to format the response

### Domain layer

Main backend logic lives in:

- `lib/auth.js`
- `lib/links.js`
- `lib/title.js`
- `lib/utils.js`

### Persistence layer

`lib/db.js` initializes MongoDB collections:

- `links`
- `users`
- `sessions`
- `refresh_tokens`

## Flow 1: Browser login

### User action

The user submits the login form in `public/login.html`.

### Frontend path

`public/js/login.js` sends:

```text
POST /api/login
```

with:

- `username`
- `password`

### Backend path

`lib/router.js` handles `/api/login` and:

1. checks login rate limit using `lib/ratelimit.js`
2. parses the JSON body
3. calls `authenticateUser()` from `lib/auth.js`
4. if valid, calls `createSession()`

### Database activity

- reads the user from `users`
- stores a hashed session token in `sessions`

### Response

The server:

- returns `{ ok: true, user }`
- sets an HTTP-only session cookie

### Browser result

`login.js` redirects the user to:

```text
/browse.html
```

## Flow 2: Load a protected page

### User action

The browser opens `/`, `/browse.html`, `/editor.html`, or `/archive.html`.

### Backend path

`lib/router.js` checks whether the page is protected.

If yes:

1. it calls `requireAuth()` from `lib/auth.js`
2. auth is resolved by checking:
   - bearer token first
   - session cookie second

### Outcome

- authenticated user: page HTML is served
- unauthenticated user: browser is redirected to `/login.html`

## Flow 3: Quick add from the home page

### User action

The user pastes a URL into the quick-add form on the home page.

### Frontend path

`public/js/home.js` does two API calls.

#### Step 1: fetch metadata

```text
GET /api/fetch-title?url=...
```

#### Step 2: save the link

```text
POST /api/links
```

### Backend path for title fetch

`lib/router.js` -> `fetchTitleForUrl()` in `lib/links.js`

That function:

1. normalizes the URL
2. checks that it resolves to a public address
3. derives the host
4. calls `fetchTitle()` in `lib/title.js`

### Backend path for create link

`lib/router.js` -> `createLink()` in `lib/links.js`

That function:

1. sanitizes the payload with `sanitizeEntry()`
2. normalizes URL and tags
3. checks for duplicate URL
4. inserts the new link

### Database activity

- reads from `links` to detect duplicate URL
- writes the new document into `links`

### Browser result

- success message is shown
- home page reloads recent links

## Flow 4: Add or edit link from the editor page

### Create flow

`public/js/editor.js` sends:

```text
POST /api/links
```

### Edit flow

`public/js/editor.js` loads existing data through `window.LinkNest.getLinks()` and then sends:

```text
PUT /api/links/:id
```

### Backend create path

- route matched in `lib/router.js`
- payload validated and sanitized in `lib/links.js`
- new link inserted into MongoDB

### Backend update path

- route matched in `lib/router.js`
- current link is loaded from MongoDB
- merged payload is re-sanitized
- duplicate URL conflict is checked
- document is updated

### Browser result

- form message updates to success or error
- duplicate archived links offer a restore action

## Flow 5: Browse library

### User action

The user opens the browse page or changes:

- search text
- status filter
- sort mode
- page number

### Frontend path

`public/js/browse.js` sends:

```text
GET /api/links?...query params...
```

### Backend path

`lib/router.js` calls `parseLinkListQuery()` from `lib/utils.js`, then passes the parsed query to `readLinks()` in `lib/links.js`.

### Query building behavior

The backend can filter by:

- active vs deleted
- status
- tag
- search text
- updated-after timestamp

It can sort by:

- `updatedAt`
- `createdAt`
- `date`
- `title`

Pinned items are always sorted first.

### Database activity

- fetches matching `links`
- counts total matching documents

### Browser result

The browse page re-renders:

- rows
- counts
- pagination
- tag chips
- unread badge

## Flow 6: Inline status change on browse page

### User action

The user taps the status dot in a row.

### Frontend path

`public/js/browse.js` cycles status through:

```text
saved -> unread -> useful -> saved
```

Then sends:

```text
PUT /api/links/:id
```

with the updated link object.

### Backend path

`lib/router.js` -> `updateLink()` in `lib/links.js`

### Database activity

- loads the current document
- re-sanitizes and updates it
- refreshes `updatedAt`

### Browser result

- row status updates immediately after success
- unread badge refreshes

## Flow 7: Pin or unpin a link

### User action

The user presses the pin button on a row.

### Frontend path

`public/js/browse.js` sends:

```text
PUT /api/links/:id
```

with `pinned` toggled.

### Backend path

Same update flow as other full-link updates.

### Result

The page reloads the current list so sort order reflects the new pinned state.

## Flow 8: Bulk status update

### User action

The user enters select mode, selects rows, and chooses a new status.

### Frontend path

`public/js/browse.js` sends:

```text
PATCH /api/links/bulk
```

with:

- `ids`
- `status`

### Backend path

`lib/router.js` -> `bulkUpdateStatus()` in `lib/links.js`

### Database activity

- updates all matching active links in one `updateMany()` call

### Browser result

- selection mode exits
- current page reloads
- unread badge refreshes

## Flow 9: Soft delete and archive view

### Soft delete

From browse, a delete action sends:

```text
DELETE /api/links/:id
```

Backend behavior:

- sets `deletedAt`
- sets `status` to `archived`
- clears `pinned`
- refreshes `updatedAt`

### Archive loading

`public/js/archive.js` requests:

```text
GET /api/links?status=deleted
```

This returns soft-deleted links only.

### Restore

Archive restore sends:

```text
POST /api/links/restore/:id
```

Backend behavior:

- sets `deletedAt` back to `null`
- restores `status` to `saved` when previous status is `archived`
- refreshes `updatedAt`

### Hard delete

Archive hard delete sends:

```text
DELETE /api/links/:id?hardDelete=true
```

This removes the document completely.

## Flow 10: Import links from pasted lines

### User action

The user pastes lines into the editor import area.

### Frontend path

`public/js/editor.js`:

1. parses each line into URL and optional title
2. optionally calls `/api/fetch-title` for missing titles
3. sends one batch request:

```text
POST /api/links/import
```

### Backend path

`lib/router.js` -> `importLinks()` in `lib/links.js`

### Database activity

- loads all existing URLs
- skips duplicates
- sanitizes valid entries
- inserts new links one by one

### Browser result

Import summary is shown to the user.

## Flow 11: Import browser bookmarks HTML

### User action

The user uploads a bookmarks HTML file in the editor page.

### Frontend path

The browser reads the file and sends:

```text
POST /api/links/import-bookmarks
```

with the raw HTML.

### Backend path

`lib/router.js`:

1. validates the body
2. calls `parseBookmarksHtml()` in `lib/links.js`
3. passes parsed links into `importLinks()`

### Result

Only valid `http` and `https` bookmark entries are imported.

## Flow 12: Export links

### User action

The user clicks export.

### Frontend path

Browser navigates to:

```text
GET /api/links/export
```

### Backend path

`lib/router.js` -> `readAllLinksForExport()` in `lib/links.js`

### Database activity

- fetches all links
- sorts by `updatedAt` descending

### Response

Returns downloadable JSON.

Important detail:

- export includes all links, not only active ones

## Flow 13: Tag chip loading

### User action

The browse page loads.

### Frontend path

`public/js/browse.js` requests:

```text
GET /api/tags?limit=15
```

### Backend path

`lib/router.js` -> `readTagCounts()` in `lib/links.js`

### Database activity

MongoDB aggregation:

- filters active links
- unwinds tags
- groups by tag
- sorts by count
- limits results

### Browser result

Top tags render as one-tap chips.

## Flow 14: Stats and unread badge

### User action

Pages load or certain actions complete.

### Frontend path

`public/js/shared.js` requests:

```text
GET /api/stats
```

### Backend path

`lib/router.js` performs several count queries.

### Database activity

Counts active links by status:

- total
- unread
- saved
- useful
- archived

### Browser result

- unread badge updates in navigation
- home dashboard stats can render from the same endpoint

## Flow 15: Link health check

### User action

The user presses “Check links” on the browse page.

### Frontend path

The frontend requests:

```text
GET /api/links/check-health
```

### Backend path

`lib/router.js`:

1. loads recent active links
2. validates that each URL points to a public address
3. performs batched `HEAD` requests
4. records status or failure reason

### Result shape

Each result may include:

- `ok: true` and HTTP status
- or `ok: false` with errors like:
  - `blocked`
  - `timeout`
  - `unreachable`
  - `failed`

### Browser result

The browse page can surface broken or unreachable links.

## Auth resolution flow

When an authenticated API request arrives, the backend checks auth in this order:

1. bearer token from `Authorization` header
2. session cookie

This means the same backend can serve:

- the web UI through cookies
- native clients through bearer tokens

## URL normalization flow

When a link is created or updated, URL normalization happens before storage.

Normalization currently includes:

- removing tracking parameters like `utm_*`, `fbclid`, and `gclid`
- removing fragment identifiers
- stripping some auth-related query parameters on login-like URLs
- deriving a clean `host`

This means the stored URL may differ slightly from the raw pasted URL.

## Error flow

Most route handlers follow this pattern:

1. parse and validate request
2. call domain logic
3. catch thrown errors
4. respond with either:
   - explicit `statusCode` and `payload`
   - or a generic fallback error

Typical API errors include:

- `400` validation or bad request
- `401` auth failure
- `404` missing link
- `409` duplicate link
- `429` login rate limit
- `500` unexpected server error

## Data flow strengths

The current design works well because:

- request flow is easy to trace end to end
- backend logic is centralized in a few clear modules
- the same API supports both browser and future mobile clients
- MongoDB schema is simple and sync-friendly

## Current flow weaknesses

A few flows are starting to show strain:

### Full-document updates from the frontend

Several UI actions send a full link payload for a small field change like:

- status
- pinned

This works, but more focused patch-style endpoints would reduce coupling.

### `getLinks()` on edit page

The editor currently loads all links and finds one item client-side when editing.

A future improvement would be a dedicated endpoint like:

```text
GET /api/links/:id
```

### Router growth

`lib/router.js` is doing more and more orchestration. Splitting route groups would make flow easier to maintain.

## Summary

The real current data flow in Link Nest is straightforward:

- page script sends API request
- router validates and dispatches
- domain logic sanitizes and applies business rules
- MongoDB stores or reads data
- JSON comes back
- page script re-renders the UI

That simplicity is one of the app’s strongest architectural traits right now.
