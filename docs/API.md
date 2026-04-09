# Link Nest API

Last updated: 2026-03-20

Link Nest exposes a private JSON API for:

- the built-in web UI using cookie sessions
- mobile or external clients using bearer access tokens plus refresh tokens

The current routes are available under both `/api/...` and `/api/v1/...`.

Base URL examples:

```text
http://localhost:3090
https://your-domain.example
```

## Authentication

### Web login with cookie sessions

```http
POST /api/login
Content-Type: application/json
```

```json
{
  "username": "your-username",
  "password": "your-password"
}
```

Successful response:

```json
{
  "ok": true,
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-03-17T08:20:17.908Z",
    "updatedAt": "2026-03-17T10:03:02.509Z"
  }
}
```

The server also sets an HTTP-only session cookie. Log out with:

```http
POST /api/logout
```

### Mobile token login

```http
POST /api/auth/token
Content-Type: application/json
```

```json
{
  "username": "your-username",
  "password": "your-password"
}
```

Successful response:

```json
{
  "ok": true,
  "tokenType": "Bearer",
  "accessToken": "<jwt>",
  "accessTokenExpiresIn": 900,
  "refreshToken": "<opaque-refresh-token>",
  "refreshTokenExpiresAt": "2026-04-19T10:00:00.000Z",
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-03-17T08:20:17.908Z",
    "updatedAt": "2026-03-17T10:03:02.509Z"
  }
}
```

Use the access token in requests:

```http
Authorization: Bearer <accessToken>
```

Refresh an expired access token:

```http
POST /api/auth/refresh
Content-Type: application/json
```

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

This revokes the old refresh token and returns a new token pair.

Revoke a refresh token:

```http
POST /api/auth/logout
Content-Type: application/json
```

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

### Get current user

```http
GET /api/me
```

Works with either:
- session cookie
- `Authorization: Bearer <token>`

Example response:

```json
{
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-03-17T08:20:17.908Z",
    "updatedAt": "2026-03-17T10:03:02.509Z"
  },
  "authMethod": "bearer"
}
```

## Link model

Links now include sync-friendly timestamps and soft-delete state:

```json
{
  "id": "42891bc9-d756-49db-9538-0717596e766c",
  "date": "2026-03-17",
  "title": "Cloud: MongoDB Cloud",
  "url": "https://cloud.mongodb.com/v2/69342bd5d4e6613219586520",
  "host": "cloud.mongodb.com",
  "tags": ["cloud"],
  "status": "saved",
  "pinned": false,
  "createdAt": "2026-03-17T08:20:17.908Z",
  "updatedAt": "2026-03-17T08:31:00.000Z",
  "deletedAt": null
}
```

## Link endpoints

All link endpoints require authentication.

### List links

```http
GET /api/links
```

Supported query params:

- `page`
- `limit` (max `200`)
- `q` or `search`
- `status`
- `tag`
- `sort` = `updatedAt`, `createdAt`, `date`, `title`
- `order` = `asc`, `desc`
- `updatedAfter` = ISO timestamp
- `includeDeleted` = `true|false`

Example:

```http
GET /api/v1/links?page=1&limit=20&q=swift&status=saved&tag=ios&sort=updatedAt&order=desc&updatedAfter=2026-03-20T00:00:00.000Z
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
    "updatedAfter": "2026-03-20T00:00:00.000Z"
  }
}
```

By default, soft-deleted links are excluded.

### Create link

```http
POST /api/links
Content-Type: application/json
```

```json
{
  "url": "https://example.com/article?utm_source=test",
  "title": "Example Article",
  "date": "2026-03-17",
  "status": "saved",
  "tags": ["reading", "reference"],
  "pinned": false
}
```

Notes:
- URL tracking parameters such as `utm_*` are cleaned automatically
- duplicate URLs return `409`
- if a matching URL already exists in soft-deleted state, create still returns `409`

### Update link

```http
PUT /api/links/:id
Content-Type: application/json
```

Updates replace the stored link fields and refresh `updatedAt`.

### Soft delete link

```http
DELETE /api/links/:id
```

This sets:
- `deletedAt` to the current time
- `updatedAt` to the current time
- `status` to `archived`
- `pinned` to `false`

### Hard delete link

```http
DELETE /api/links/:id?hardDelete=true
```

Use this only when you truly want the document removed from MongoDB.

### Restore a soft-deleted link

```http
POST /api/links/restore/:id
```

This clears `deletedAt` and updates `updatedAt`.

### Import links

```http
POST /api/links/import
Content-Type: application/json
```

```json
{
  "links": [
    {
      "url": "https://example.com/one",
      "title": "One",
      "date": "2026-03-17",
      "status": "saved",
      "tags": []
    }
  ]
}
```

Malformed entries are skipped during import.

### Export links

```http
GET /api/links/export
```

Returns a JSON download of all links, including soft-deleted records.

### Fetch page title

```http
GET /api/fetch-title?url=https%3A%2F%2Fexample.com
```

Response:

```json
{
  "title": "Example Domain",
  "url": "https://example.com/",
  "host": "example.com"
}
```

## Validation rules

- `url` is required and must be a valid absolute URL
- `date` must use `YYYY-MM-DD`
- `title` max length is `300`
- `tags` max count is `20`
- each tag max length is `50`
- `status` values are `saved`, `unread`, `useful`, `archived`

## Common errors

Unauthorized:

```json
{
  "error": "Authentication required"
}
```

Duplicate URL:

```json
{
  "error": "This link already exists",
  "url": "https://example.com/article"
}
```

Invalid refresh token:

```json
{
  "error": "Invalid or expired refresh token"
}
```

Link not found:

```json
{
  "error": "Link not found"
}
```
