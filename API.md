# Link Vault API

Link Vault exposes a private JSON API for both:

- the built-in web UI using cookie sessions
- native or external clients using JWT bearer tokens

Base URL examples:

```text
http://localhost:3090
https://your-domain.example
```

## Authentication modes

### 1. Web login with cookie sessions
Use this for the browser UI.

Login request:

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

The server also sets an HTTP-only session cookie.

Logout:

```http
POST /api/logout
```

### 2. JWT bearer token auth
Use this for native apps such as iPhone, iPad, or macOS apps.

Token request:

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
  "expiresIn": 2592000,
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-03-17T08:20:17.908Z",
    "updatedAt": "2026-03-17T10:03:02.509Z"
  }
}
```

Use the token in requests:

```http
Authorization: Bearer <accessToken>
```

## Auth inspection

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
  "authMethod": "cookie"
}
```

`authMethod` can be:
- `cookie`
- `bearer`

## Link endpoints

All link endpoints require authentication.

### List links
```http
GET /api/links
```

Response:

```json
{
  "links": [
    {
      "id": "42891bc9-d756-49db-9538-0717596e766c",
      "date": "2026-03-17",
      "title": "Cloud: MongoDB Cloud",
      "url": "https://cloud.mongodb.com/v2/69342bd5d4e6613219586520",
      "host": "cloud.mongodb.com",
      "tags": [],
      "notes": "",
      "status": "saved",
      "pinned": false,
      "updatedAt": "2026-03-17T08:31:00.000Z"
    }
  ],
  "total": 1
}
```

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
  "notes": "Useful later",
  "pinned": false
}
```

Response:

```json
{
  "ok": true,
  "entry": {
    "id": "generated-id",
    "date": "2026-03-17",
    "title": "Example Article",
    "url": "https://example.com/article",
    "host": "example.com",
    "tags": ["reading", "reference"],
    "notes": "Useful later",
    "status": "saved",
    "pinned": false,
    "updatedAt": "2026-03-17T10:00:00.000Z"
  }
}
```

Notes:
- URL tracking parameters such as `utm_*` are cleaned automatically.
- duplicate URLs return `409`

### Update link
```http
PUT /api/links/:id
Content-Type: application/json
```

Example:

```json
{
  "title": "Updated title",
  "url": "https://example.com/article",
  "date": "2026-03-17",
  "status": "useful",
  "tags": ["updated"],
  "notes": "Updated note",
  "pinned": true
}
```

Response:

```json
{
  "ok": true,
  "entry": {
    "id": "generated-id",
    "date": "2026-03-17",
    "title": "Updated title",
    "url": "https://example.com/article",
    "host": "example.com",
    "tags": ["updated"],
    "notes": "Updated note",
    "status": "useful",
    "pinned": true,
    "updatedAt": "2026-03-17T10:05:00.000Z"
  }
}
```

### Delete link
```http
DELETE /api/links/:id
```

Response:

```json
{
  "ok": true,
  "total": 12
}
```

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
      "tags": [],
      "notes": ""
    },
    {
      "url": "https://example.com/two",
      "title": "Two",
      "date": "2026-03-17",
      "status": "saved",
      "tags": [],
      "notes": ""
    }
  ]
}
```

Response:

```json
{
  "ok": true,
  "imported": 2,
  "total": 14
}
```

Malformed entries are skipped during import.

### Export links
```http
GET /api/links/export
```

Returns a JSON file download.

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

## Status values

Allowed status values:
- `saved`
- `unread`
- `useful`
- `archived`

Invalid values are normalized to `saved`.

## Error responses

Common error responses:

### Unauthorized
```json
{
  "error": "Authentication required"
}
```

### Invalid login
```json
{
  "error": "Invalid username or password"
}
```

### Duplicate URL
```json
{
  "error": "This link already exists",
  "url": "https://example.com/article"
}
```

### Link not found
```json
{
  "error": "Link not found"
}
```

## Apple app integration notes

Recommended native-app flow:

1. Call `POST /api/auth/token`
2. Store `accessToken` in Keychain
3. Send `Authorization: Bearer <token>` on each API request
4. Refresh by logging in again when token expires

Current token lifetime is controlled by:

```bash
JWT_TTL_DAYS=30
```

## Suggested next backend improvements

If you want to turn this into a stronger service API later, good next steps are:

- add `/api/v1/...` route versioning
- add CORS configuration for separate app domains
- add refresh tokens
- add pagination and search query params
- add per-user link ownership if multi-user support grows
