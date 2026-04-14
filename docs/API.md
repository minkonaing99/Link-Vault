# Link Nest API

Last updated: 2026-04-14

Link Nest exposes a private JSON API for:

- the built-in web UI using cookie sessions
- mobile or external clients using bearer access tokens and refresh tokens

All documented routes are available under both:

- `/api/...`
- `/api/v1/...`

Examples in this document use `/api/...` for brevity.

## Base URL

Examples:

```text
http://localhost:3080
https://your-domain.example
```

## Authentication

Link Nest supports two auth styles.

### 1. Cookie session auth for the website

Used by the built-in browser UI.

#### Log in

```http
POST /api/login
Content-Type: application/json
```

Request body:

```json
{
  "username": "your-username",
  "password": "your-password"
}
```

Success response:

```json
{
  "ok": true,
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-04-14T00:00:00.000Z",
    "updatedAt": "2026-04-14T00:00:00.000Z"
  }
}
```

Notes:

- the server also sets an HTTP-only session cookie
- repeated failed login attempts are rate-limited
- invalid credentials return `401`
- too many attempts return `429`

#### Log out

```http
POST /api/logout
```

Success response:

```json
{
  "ok": true
}
```

This clears the session cookie and removes the stored session if present.

### 2. Bearer token auth for mobile or external clients

Used by native apps or API clients.

#### Get access token and refresh token

```http
POST /api/auth/token
Content-Type: application/json
```

Request body:

```json
{
  "username": "your-username",
  "password": "your-password"
}
```

Success response:

```json
{
  "ok": true,
  "tokenType": "Bearer",
  "accessToken": "<jwt>",
  "accessTokenExpiresIn": 900,
  "refreshToken": "<opaque-refresh-token>",
  "refreshTokenExpiresAt": "2026-05-14T00:00:00.000Z",
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-04-14T00:00:00.000Z",
    "updatedAt": "2026-04-14T00:00:00.000Z"
  }
}
```

Use the access token like this:

```http
Authorization: Bearer <accessToken>
```

#### Refresh an access token

```http
POST /api/auth/refresh
Content-Type: application/json
```

Request body:

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

Success response returns a new token pair.

Notes:

- refresh tokens are rotated
- invalid or expired refresh tokens return `401`

#### Revoke a refresh token

```http
POST /api/auth/logout
Content-Type: application/json
```

Request body:

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

Success response:

```json
{
  "ok": true,
  "revoked": true
}
```

## Current user

### Get current authenticated user

```http
GET /api/me
```

Works with either:

- session cookie
- bearer token

Success response:

```json
{
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-04-14T00:00:00.000Z",
    "updatedAt": "2026-04-14T00:00:00.000Z"
  },
  "authMethod": "cookie"
}
```

If not authenticated:

```json
{
  "error": "Authentication required"
}
```

## Link model

A link document returned by the API looks like this:

```json
{
  "id": "42891bc9-d756-49db-9538-0717596e766c",
  "date": "2026-04-14",
  "title": "Example Article",
  "url": "https://example.com/article",
  "host": "example.com",
  "tags": ["reading", "reference"],
  "status": "saved",
  "pinned": false,
  "createdAt": "2026-04-14T00:00:00.000Z",
  "updatedAt": "2026-04-14T00:00:00.000Z",
  "deletedAt": null
}
```

### Field notes

- `id` is the app-level identifier
- `date` uses `YYYY-MM-DD`
- `status` is one of `saved`, `unread`, `useful`, `archived`
- `deletedAt = null` means the link is active
- `deletedAt != null` means the link is soft-deleted
- `host` is derived from the normalized URL

## Protected endpoints

Every endpoint below requires authentication unless stated otherwise.

## Link listing

### List links

```http
GET /api/links
```

Supported query params:

- `page`
- `limit` (default `50`, max `200`)
- `q`
- `search` (alias of `q`)
- `status`
- `tag`
- `sort` = `updatedAt`, `createdAt`, `date`, `title`
- `order` = `asc`, `desc`
- `updatedAfter` = ISO datetime
- `includeDeleted` = `true|false`

Examples:

```http
GET /api/links?page=1&limit=20
```

```http
GET /api/links?q=swift&status=saved&tag=ios&sort=updatedAt&order=desc
```

```http
GET /api/links?status=deleted
```

```http
GET /api/links?includeDeleted=true
```

Response:

```json
{
  "links": [],
  "total": 0,
  "page": 1,
  "limit": 20,
  "pages": 0,
  "query": {
    "q": "swift",
    "status": "saved",
    "tag": "ios",
    "sort": "updatedAt",
    "order": "desc",
    "includeDeleted": false,
    "updatedAfter": null
  }
}
```

### Listing behavior

- active lists exclude deleted links by default
- `status=deleted` returns only soft-deleted links
- `q` searches `title`, `url`, `host`, `tags`, and `date`
- sorting always keeps pinned items first

## Link write operations

### Create a link

```http
POST /api/links
Content-Type: application/json
```

Request body:

```json
{
  "url": "https://example.com/article?utm_source=test",
  "title": "Example Article",
  "date": "2026-04-14",
  "status": "saved",
  "tags": ["reading", "reference"],
  "pinned": false
}
```

Success response:

```json
{
  "ok": true,
  "entry": {
    "id": "link-id",
    "date": "2026-04-14",
    "title": "Example Article",
    "url": "https://example.com/article",
    "host": "example.com",
    "tags": ["reading", "reference"],
    "status": "saved",
    "pinned": false,
    "createdAt": "2026-04-14T00:00:00.000Z",
    "updatedAt": "2026-04-14T00:00:00.000Z",
    "deletedAt": null
  }
}
```

Behavior:

- URLs are normalized before storage
- common tracking parameters like `utm_*`, `fbclid`, and `gclid` are removed
- invalid URLs return `400`
- duplicate URLs return `409`
- if a matching URL already exists in archived state, the response includes the existing id and `archived: true`

Example duplicate response:

```json
{
  "error": "This link already exists but is archived",
  "url": "https://example.com/article",
  "id": "existing-link-id",
  "archived": true
}
```

### Update a link

```http
PUT /api/links/:id
Content-Type: application/json
```

Request body uses the same shape as create.

Success response:

```json
{
  "ok": true,
  "entry": {
    "id": "link-id"
  }
}
```

Behavior:

- updates re-sanitize and normalize the full link
- `updatedAt` is refreshed automatically
- changing the URL to one already used by another link returns `409`
- missing ids return `404`

### Soft-delete a link

```http
DELETE /api/links/:id
```

Success response:

```json
{
  "ok": true,
  "total": 42
}
```

Behavior:

- sets `deletedAt` to now
- sets `updatedAt` to now
- forces `status` to `archived`
- clears `pinned`
- returns the count of active links after deletion

### Hard-delete a link

```http
DELETE /api/links/:id?hardDelete=true
```

This permanently removes the document.

### Restore a soft-deleted link

```http
POST /api/links/restore/:id
```

Success response:

```json
{
  "ok": true,
  "entry": {
    "id": "link-id"
  }
}
```

Behavior:

- sets `deletedAt` back to `null`
- refreshes `updatedAt`
- if the old status was `archived`, it becomes `saved`

## Bulk operations

### Bulk update status

```http
PATCH /api/links/bulk
Content-Type: application/json
```

Request body:

```json
{
  "ids": ["id-1", "id-2"],
  "status": "useful"
}
```

Success response:

```json
{
  "ok": true,
  "updated": 2
}
```

Rules:

- `ids` must be a non-empty array
- maximum batch size is `200`
- only active links are updated

## Tag endpoints

### Get popular tags

```http
GET /api/tags?limit=15
```

Success response:

```json
{
  "tags": [
    { "tag": "ios", "count": 12 },
    { "tag": "security", "count": 7 }
  ]
}
```

Notes:

- only active links are counted
- `limit` defaults to `20`
- allowed range is `1..50`

## Stats endpoint

### Get library stats

```http
GET /api/stats
```

Success response:

```json
{
  "total": 120,
  "unread": 30,
  "saved": 70,
  "useful": 20,
  "archived": 0
}
```

Notes:

- counts are based on current stored status values
- `total` counts active links only

## Title metadata

### Fetch title metadata for a URL

```http
GET /api/fetch-title?url=https%3A%2F%2Fexample.com%2Farticle
```

Success response:

```json
{
  "title": "Example Article",
  "url": "https://example.com/article",
  "host": "example.com",
  "needsManualEntry": false
}
```

Behavior:

- URL is normalized first
- private and reserved network targets are blocked
- title fetching may use oEmbed for supported providers
- if title extraction fails cleanly, `needsManualEntry` may be `true`

Example fallback response:

```json
{
  "title": "",
  "url": "https://example.com/protected-page",
  "host": "example.com",
  "needsManualEntry": true
}
```

## Import and export

### Export all links

```http
GET /api/links/export
```

Returns the full link list as downloadable JSON.

Notes:

- export includes all links, including soft-deleted ones
- response is sent as `application/json`

### Import links from JSON payload

```http
POST /api/links/import
Content-Type: application/json
```

Request body:

```json
{
  "links": [
    {
      "url": "https://example.com/article",
      "title": "Example Article",
      "date": "2026-04-14",
      "status": "saved",
      "tags": []
    }
  ]
}
```

#### Batch text import format

The editor page also supports pasting plain text lines in this format:

```
https://example.com | Example Site
https://another.com | Another Site
```

Each line is `url | title`. The title is optional — if omitted the backend fetches it or falls back to the URL.

Success response:

```json
{
  "ok": true,
  "imported": 1,
  "total": 43
}
```

Rules:

- maximum import batch size is `5000`
- duplicates are skipped
- invalid items are skipped
- `total` is the active-link count after import

### Import browser bookmarks HTML

```http
POST /api/links/import-bookmarks
Content-Type: application/json
```

Request body:

```json
{
  "html": "<DL><p>...browser bookmarks html...</DL>"
}
```

Success response:

```json
{
  "ok": true,
  "imported": 10,
  "total": 53,
  "parsed": 14
}
```

Behavior:

- parses `<a href="...">` entries from bookmark HTML
- only `http` and `https` links are imported
- missing or invalid links are skipped
- imported bookmark items default to `status: saved`

## Link health checking

### Check saved links for reachability

```http
GET /api/links/check-health
```

Optional query params:

- `limit` (default `100`, max `200`)

Success response:

```json
{
  "total": 3,
  "broken": 1,
  "checks": [
    {
      "id": "id-1",
      "url": "https://example.com",
      "title": "Example",
      "ok": true,
      "status": 200
    },
    {
      "id": "id-2",
      "url": "https://bad.example",
      "title": "Bad",
      "ok": false,
      "status": 0,
      "error": "timeout"
    }
  ]
}
```

Behavior:

- checks active links only
- uses `HEAD` requests with redirect following
- times out each request after about 7 seconds
- blocks private or reserved targets before making the request
- possible error values include `blocked`, `timeout`, `unreachable`, and `failed`

## Common errors

Example error response:

```json
{
  "error": "Link not found"
}
```

Common status codes:

- `200` success
- `201` created
- `400` bad request or validation error
- `401` authentication required or invalid credentials
- `404` resource not found
- `409` duplicate or conflicting resource
- `429` too many login attempts
- `500` internal server error

## Validation rules and behavior notes

### URL rules

- URL must be absolute
- only `http` and `https` are supported for outbound title and health checks
- some tracking and auth-related query params are stripped during normalization
- URL fragments are removed

### Tag rules

- tags are normalized into unique trimmed values
- max tag count is `20`
- max tag length is `50`

### Title rules

- max title length is `300`
- if no title is provided, the normalized URL is used

### Date rules

- `date` must use `YYYY-MM-DD`

## HTML page routes

These are not JSON API endpoints, but useful to know for client behavior:

- `/` → home page
- `/browse.html`
- `/editor.html`
- `/archive.html`
- `/login.html`
- `/offline.html`
- `/logout` → clears session and redirects to login

Protected pages require authentication.

### iOS Share Sheet / Shortcuts

The editor page accepts pre-filled query params for use with iOS Shortcuts or any external tool:

```
/editor.html?url=<encoded-url>&title=<encoded-title>
```

Both params are optional. If `url` is provided without `title`, the app will attempt to fetch the title automatically.

## Versioning note

The app currently serves both `/api/...` and `/api/v1/...` routes with the same behavior. There is no separate v1-only logic yet.
