# LinksVault

Last updated: 2026-03-21

LinksVault is a private website for saving, organizing, and revisiting useful links in one clean library.

It is designed for people who want a calmer alternative to messy browser bookmarks, scattered notes, or saving links across multiple apps. The project includes a built-in web interface and a JSON API, so the same database can later be used by a mobile app such as iOS.

## What The Website Does

LinksVault helps you collect links and keep them easy to find later.

You can:

- save links with a title, status, tags, and date
- auto-fetch the page title from a pasted URL
- browse saved links in a cleaner library view
- search, filter, sort, pin, edit, restore, and soft-delete links
- export data as JSON
- use the same backend for both the website and future mobile clients

## Main Pages

### Home

The home page gives a compact overview of your library. It includes summary cards, recent items, and a quick-add input for saving a link fast.

### Browse

The browse page is the main library view. It is built for scanning links quickly, filtering by status or tag, and managing items without leaving the page.

### Add Link

The add-link page is used for creating or updating saved links with a more complete form.

### Login

The login page protects the site behind private authentication and keeps the library limited to approved users.

## Core Features

### Private Authentication

The website supports browser login using secure session cookies. The backend also supports token-based authentication for mobile or external clients.

### Link Organization

Each saved item is structured for long-term use instead of simple bookmarking. Links can be tagged, pinned, marked by status, and filtered later.

### Auto Title Fetching

When a URL is added, the app can fetch the page title automatically to reduce manual typing and keep entries consistent.

### Search And Filtering

The library supports search, pagination, filtering, sorting, and sync-friendly queries such as `updatedAfter`.

### Soft Delete And Restore

Links are soft-deleted by default, which makes it easier to support recovery and future app sync behavior.

### API-Ready Backend

The backend is structured so the website and an iOS app can use the same MongoDB database and the same API.

## Tech Stack

LinksVault is built with:

- Node.js
- a plain HTTP server
- MongoDB
- vanilla HTML, CSS, and JavaScript on the frontend
- `bcryptjs` for password hashing
- JWT access tokens plus refresh tokens for app clients

## Data Model Notes

Links are stored in MongoDB and include sync-friendly timestamps.

Key fields include:

- `url`
- `title`
- `tags`
- `status`
- `pinned`
- `createdAt`
- `updatedAt`
- `deletedAt`

## Authentication Modes

### Browser Sessions

The website uses cookie-based login for the browser UI.

### Mobile Or External Clients

The API also supports bearer access tokens with refresh tokens, which makes it suitable for an iOS app or other clients using the same backend.

## API Overview

The project exposes private JSON API routes under:

- `/api/...`
- `/api/v1/...`

Main API groups:

- login, logout, and identity
- token and refresh-token auth
- link listing with pagination and filters
- create, update, soft delete, restore, and hard delete
- title fetching
- import and export

Full API details are documented in [API.md](./API.md).

## Product Direction

LinksVault is intended to be more than a simple bookmark page. The long-term direction is a personal link library with:

- a private web interface
- mobile app support
- shared API access
- sync-friendly data handling

That makes the current website a usable product on its own while also serving as the backend foundation for future iOS development.
