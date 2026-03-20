# Link Vault

Link Vault is a private link library built with:

- plain Node.js HTTP server
- MongoDB Atlas
- cookie-based web auth
- JWT bearer-token auth for native or external clients

It supports a built-in web UI and can also act as a backend service for a future Apple app.

## Features

- save, edit, delete, and browse links
- tags, notes, status, and pinning
- URL cleanup for noisy tracking params
- title fetching from pages
- bulk import and JSON export
- private login for the web UI
- JWT token auth for app/API clients

## Storage

Link Vault uses **MongoDB Atlas** only.

Legacy JSON file storage is disabled.

## Environment

Create a local `.env` file:

```bash
MONGODB_URI=mongodb+srv://linkvault_user:YOUR_PASSWORD@personal.os6g19g.mongodb.net/?retryWrites=true&w=majority&appName=personal
MONGODB_DB_NAME=linkvault
PORT=3090
AUTH_COOKIE_NAME=linkvault_session
AUTH_SESSION_TTL_DAYS=30
JWT_TTL_DAYS=30
JWT_SECRET=replace-with-a-long-random-secret
LINKVAULT_ADMIN_USERNAME=thomas
LINKVAULT_ADMIN_PASSWORD=change-this-now
```

### Important
- keep `.env` out of git
- use a long random `JWT_SECRET`
- rotate secrets if they were exposed

## Install and run

```bash
npm install
npm start
```

Default local URL:

```text
http://localhost:3090
```

## Authentication

Link Vault supports two auth modes.

### 1. Cookie session auth
Used by the browser UI.

- login page: `/login.html`
- logout endpoint: `POST /api/logout`
- session lifetime controlled by `AUTH_SESSION_TTL_DAYS`

### 2. JWT bearer token auth
Used by native apps or external clients.

Token endpoint:

```http
POST /api/auth/token
```

Then send:

```http
Authorization: Bearer <accessToken>
```

Token lifetime is controlled by:

```bash
JWT_TTL_DAYS=30
```

## Initial admin user
On startup, Link Vault syncs the admin credentials from `.env` into MongoDB:

- `LINKVAULT_ADMIN_USERNAME`
- `LINKVAULT_ADMIN_PASSWORD`

This is convenient for a single-user private setup.

## Web pages

- `/login.html` — sign in
- `/` — home
- `/browse.html` — browse and manage links
- `/editor.html` — add/edit/import/export links

All app pages except the login page require authentication.

## API

See full API documentation here:

- [API.md](./API.md)

Main endpoints include:

- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `POST /api/auth/token`
- `GET /api/links`
- `POST /api/links`
- `PUT /api/links/:id`
- `DELETE /api/links/:id`
- `POST /api/links/import`
- `GET /api/links/export`
- `GET /api/fetch-title?url=...`

## Apple app usage

Yes — this backend can be used by a future Apple app.

Recommended flow:

1. your app calls `POST /api/auth/token`
2. store the JWT in Keychain
3. call Link Vault APIs with `Authorization: Bearer <token>`

## Current implementation notes

- password hashing uses `bcryptjs`
- sessions are stored in MongoDB
- bearer tokens are JWTs signed with `JWT_SECRET`
- links are stored in the `links` collection
- users are stored in the `users` collection
- browser sessions are stored in the `sessions` collection

## Suggested next improvements

- API versioning such as `/api/v1/...`
- refresh-token flow for native apps
- CORS configuration for separate frontend/app origins
- pagination and search params
- multi-user ownership for links
