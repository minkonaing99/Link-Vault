# Link Vault

Last updated: 2026-03-20

Link Vault is a private link library built with:

- plain Node.js HTTP server
- MongoDB
- cookie-based web auth for the browser UI
- bearer access tokens plus refresh tokens for mobile or external clients

It supports a built-in web UI and can also act as the backend for an iOS app using the same database.

## Features

- save, edit, browse, restore, and soft-delete links
- tags, status, pinning, and URL cleanup
- auto-fetch page titles
- bulk import and JSON export
- paginated API queries with search, filters, sort, and sync-friendly `updatedAfter`
- private browser login plus token auth for app clients

## Storage

Link Vault uses MongoDB only. Legacy JSON storage is disabled.

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

### 2. Mobile/API token auth

Used by iOS apps or other clients.

- login for token pair: `POST /api/auth/token`
- refresh access token: `POST /api/auth/refresh`
- revoke refresh token: `POST /api/auth/logout`

## API

See full API documentation here:

- [API.md](./API.md)
- [DEPLOY_EC2.md](./DEPLOY_EC2.md)

Main endpoint groups:

- auth: `/api/auth/...` and `/api/v1/auth/...`
- links: `/api/links...` and `/api/v1/links...`

## Deployment

For an Ubuntu EC2 deployment guide with Nginx and PM2:

- [DEPLOY_EC2.md](./DEPLOY_EC2.md)

## Current implementation notes

- password hashing uses `bcryptjs`
- browser sessions are stored in MongoDB
- refresh tokens are stored in MongoDB and can be revoked
- access tokens are JWTs signed with `JWT_SECRET`
- links include `createdAt`, `updatedAt`, and `deletedAt`
- link deletes are soft deletes by default

## Recommended next improvements

- add per-user link ownership for multi-user support
- add CORS configuration if the mobile app is served from a different origin pattern
- add automated API tests for auth, validation, filtering, and restore flows
- add conflict-aware sync semantics if the iOS app will support offline edits
