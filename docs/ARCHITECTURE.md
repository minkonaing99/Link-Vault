# Link Nest Architecture

Last updated: 2026-04-14

This document explains how Link Nest is structured, how requests move through the system, and why the project is organized this way.

## Overview

Link Nest is a private link library application with:

- a server-rendered static frontend using plain HTML, CSS, and JavaScript
- a small Node.js backend built on the built-in `http` module
- MongoDB for persistence
- two auth modes:
  - cookie sessions for the web UI
  - access tokens plus refresh tokens for mobile or external clients

The current shape is intentionally simple. It avoids a heavy framework, keeps control over request handling, and leaves room for future clients like iOS to use the same backend.

## High-Level Architecture

```text
Browser / future mobile client
        |
        v
   server.js
        |
        v
   lib/router.js
        |
        +--> lib/auth.js
        +--> lib/links.js
        +--> lib/title.js
        +--> lib/db.js
        +--> lib/utils.js
        +--> lib/http.js
        +--> lib/ratelimit.js
        |
        v
     MongoDB
```

Static assets are served from `public/`.

## Main Goals Of The Architecture

The project is designed around a few priorities:

- keep the backend simple enough to understand deeply
- support both website and API clients from the same codebase
- make link data durable and sync-friendly
- keep security basics built into the default flow
- avoid framework complexity until it is clearly needed

## Runtime Entry Point

### `server.js`

`server.js` is the application entry point.

It is responsible for:

- loading config from `lib/config.js`
- connecting to MongoDB
- ensuring the initial admin user exists
- starting the HTTP server exported from `lib/router.js`
- applying a 30-second socket timeout to reduce stalled connections
- shutting down MongoDB cleanly on `SIGINT` and `SIGTERM`

This file stays intentionally small. It boots the app, then hands real request work to the router.

## Request Flow

A typical request follows this path:

1. the HTTP server receives the request
2. `lib/router.js` parses the URL and method
3. auth checks run if the route is protected
4. request body parsing and validation happen as needed
5. domain logic is delegated to `lib/auth.js`, `lib/links.js`, or `lib/title.js`
6. database operations happen through collections initialized in `lib/db.js`
7. response helpers in `lib/http.js` send JSON, text, redirects, or files

This keeps responsibilities separated:

- routing decides what should happen
- domain modules decide how it should happen
- HTTP helpers decide how it is returned

## Backend Modules

### `lib/config.js`

Centralizes environment-based configuration.

It defines:

- port and project paths
- MongoDB database and collection names
- auth cookie name and TTL values
- JWT settings
- admin bootstrap credentials
- URL and entry limits
- proxy trust behavior
- protected and public pages

It also fails fast when required values are missing, especially `MONGODB_URI` and `JWT_SECRET`.

### `lib/db.js`

Owns MongoDB connection setup and collection initialization.

Responsibilities:

- connect once and reuse the client
- expose active collections
- create indexes for links, users, sessions, and refresh tokens
- remove a legacy text index when present
- create or update the initial admin user

The database layer is intentionally thin. It does not try to be an ORM. It keeps MongoDB visible and direct.

### `lib/router.js`

This is the main HTTP controller.

It handles:

- route matching
- request parsing
- auth enforcement
- endpoint orchestration
- static file delivery
- fallback behavior for protected pages and login redirects

The router exposes both:

- website-facing routes like `/`, `/browse.html`, `/login.html`
- API routes like `/api/links`, `/api/login`, `/api/fetch-title`

The same router supports both web and API clients, which is why auth is checked in a way that can return either JSON errors or browser redirects.

### `lib/auth.js`

Handles authentication and token/session management.

It supports two parallel auth systems:

#### 1. Cookie sessions for the website

- user logs in through `/api/login`
- server verifies credentials
- server creates a session token
- token hash is stored in MongoDB
- raw token is sent back as an HTTP-only cookie
- protected web pages use this cookie automatically

#### 2. Bearer tokens for mobile or external clients

- user logs in through `/api/auth/token`
- server returns a JWT access token and opaque refresh token
- refresh tokens are stored hashed in MongoDB
- `/api/auth/refresh` rotates refresh tokens
- `/api/auth/logout` revokes refresh tokens

This split is one of the strongest parts of the architecture because it keeps the browser UX simple while still preparing the backend for native clients.

### `lib/links.js`

This is the core link domain module.

Responsibilities:

- create links
- update links
- soft delete and restore links
- hard delete when requested
- import links
- export links
- read lists with filters and pagination
- fetch popular tags
- perform bulk status changes
- fetch title metadata for a URL

This module represents the real product behavior. If the app grows, this file will likely be the first place that benefits from splitting into smaller submodules.

### `lib/title.js`

Handles link title extraction and metadata fetching.

It does more than a naive page fetch:

- checks oEmbed providers for supported hosts
- streams only the HTML head when possible
- detects charset from headers or meta tags
- extracts meta titles and raw document titles
- decodes HTML entities
- tries to clean noisy titles

This is a good example of backend value. The app is not just storing URLs, it is normalizing and improving them.

### `lib/utils.js`

Contains shared normalization and validation logic.

Examples:

- URL normalization
- host derivation
- tag normalization
- status normalization
- list query parsing
- entry sanitization
- public URL checks to reduce SSRF risk
- user-safe object shaping

This file acts as the shared rules layer. A lot of product consistency depends on it.

### `lib/http.js`

Provides response helpers and security headers.

It standardizes:

- JSON responses
- plain text responses
- redirects
- static file responses
- request body parsing

It also applies security headers such as:

- `Content-Security-Policy`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Strict-Transport-Security`

### `lib/ratelimit.js`

Provides lightweight in-memory login rate limiting.

It is currently focused on auth protection:

- tracks failed login attempts by IP
- locks repeated failures for a time window
- optionally trusts `X-Forwarded-For` only when `TRUSTED_PROXY` is enabled

This is simple but appropriate for a small private app.

## Frontend Architecture

The frontend lives in `public/` and is intentionally framework-free.

### HTML pages

Main pages:

- `index.html` for quick add and recent links
- `browse.html` for library management
- `editor.html` for add and edit flows
- `archive.html` for deleted items
- `login.html` for authentication
- `offline.html` for PWA offline fallback

### Frontend JavaScript

Scripts are separated by page responsibility:

- `shared.js` contains common helpers, logout flow, unread badge updates, service worker registration, and pull-to-refresh support
- `home.js` powers quick add and recent items
- `browse.js` powers search, sorting, bulk actions, tag chips, pinning, and status cycling
- `editor.js` powers create, edit, import, and title fetching flows
- `archive.js` powers restore and hard delete for archived items
- `login.js` powers the sign-in form

`shared.js` exposes a `window.LinkNest` namespace used by all page scripts:

- `apiFetch` — authenticated fetch wrapper
- `getLinks` — fetch links with query params
- `setMessage` — show success/error message in UI
- `parseTags` — normalize tag string input
- `queryParam` — read URL query params
- `updateUnreadBadge()` — refresh the unread count pill in nav
- `initPullToRefresh(onRefresh)` — attach pull-to-refresh gesture

Keyboard shortcuts: `/` focuses the search box, `Esc` clears it.

### Responsive UI

- **Check links** and **Export** buttons are hidden at ≤768px
- Title truncation: 70 chars desktop / 55 chars mobile (≤768px breakpoint)

This is a simple multi-page app architecture rather than a single-page app.

That choice has tradeoffs:

### Benefits

- easier to understand
- no frontend build step
- low complexity
- pages remain directly inspectable

### Costs

- more manual DOM code
- shared UI behavior must be maintained carefully
- state management can become repetitive as features grow

For the current size of the project, this tradeoff is reasonable.

## Data Model

The main entity is a link document.

Current fields include:

- `id`
- `url`
- `title`
- `host`
- `date`
- `tags`
- `status`
- `pinned`
- `createdAt`
- `updatedAt`
- `deletedAt`

### Why this model works well

- `id` avoids exposing MongoDB `_id` to clients
- `deletedAt` enables soft delete and future sync behavior
- timestamps support incremental sync and conflict-aware clients later
- `host` improves search and display
- `status` keeps the product focused on revisit workflow, not just storage

Related collections:

- `users`
- `sessions`
- `refresh_tokens`

## Authentication Architecture

The system intentionally supports both browser and API authentication.

### Browser flow

Best for:
- the built-in website

Properties:
- cookie-based
- HTTP-only session token
- browser-friendly redirects for protected pages

### API flow

Best for:
- iOS app
- automation clients
- future integrations

Properties:
- short-lived access token
- longer-lived refresh token
- refresh token rotation
- stateless access token verification plus database-backed refresh control

This dual-mode design is one of the main architectural decisions that makes the backend reusable.

## Security Design

Several important security controls are already present:

- password hashing with `bcryptjs`
- session and refresh token hashing before storage
- minimum secret length enforcement for JWT secret
- HTTP-only cookies
- login rate limiting
- CSP and other security headers
- URL validation to block private or reserved network targets
- no trust in forwarded IP headers unless explicitly enabled
- protected route checks for both HTML pages and JSON endpoints
- request body size limit in `parseBody`
- socket timeout on the server

This is a solid baseline for a private app.

## Static Delivery And PWA Behavior

Static assets are served directly from `public/`.

A service worker adds:

- precaching for public assets
- offline page fallback
- runtime caching for navigation responses
- network-only handling for API requests

This gives the app lightweight PWA behavior without adding a frontend framework.

## Why The Current Architecture Works

The current structure is strong because it matches the product stage.

It is:

- small enough to understand fully
- modular enough to extend
- backend-first
- future-client aware
- simple to deploy

It avoids premature abstraction while still separating concerns in useful ways.

## Current Architectural Limits

The project is good, but some limits are starting to show.

### 1. `router.js` is growing into a large controller

As more routes are added, this file will become harder to maintain.

A likely next step is splitting route handlers into domain route modules, for example:

- `routes/auth.js`
- `routes/links.js`
- `routes/system.js`

### 2. `links.js` mixes several responsibilities

It currently handles:

- CRUD
- import logic
- export logic
- tag stats
- bulk operations
- title-related helper behavior

That is manageable now, but eventually it may want smaller modules such as:

- `links/service.js`
- `links/import.js`
- `links/query.js`

### 3. frontend state is manually coordinated

The current vanilla JS approach is fine, but as UX grows, repeated fetch/update/render logic will get harder to maintain.

### 4. there is no test layer yet

For a backend with auth, normalization, URL safety, and import logic, tests would add a lot of confidence.

The highest-value early tests would be:

- auth token/session behavior
- URL normalization and SSRF blocking
- link sanitization
- list query parsing
- import behavior

## Recommended Next Architectural Improvements

If you want to strengthen the architecture without overengineering it, the best next moves are:

1. split `router.js` into route modules
2. add a small test suite for core backend rules
3. separate link domain logic into query/import/write modules
4. add structured error helpers instead of repeating route-level error shaping
5. document data flow for the future mobile client

## Summary

Link Nest uses a clean, practical architecture:

- plain Node.js HTTP server
- MongoDB persistence
- modular backend helpers
- multi-page vanilla frontend
- browser and API auth support
- security-aware URL and auth handling

The design is strongest in two areas:

- it is simple enough to reason about end to end
- it is already shaped for future mobile clients

That makes it a good foundation for a personal product that can grow without needing an early rewrite.
