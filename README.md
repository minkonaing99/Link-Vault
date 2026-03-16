# Link Vault

Link Vault is a minimalist local website for saving, browsing, and organizing links.

## Features

- clean multi-page UI
- home, browse, and editor pages
- compact library rows
- pin/unpin links
- date grouping: `Today`, `Yesterday`, `Earlier`
- sort controls
- add, edit, and delete links
- tags, notes, and status fields
- batch paste import with `URL | Title`
- export JSON
- clipboard paste helper on editor page
- automatic URL cleanup for tracking/auth callback parameters
- favicon support

## Project Path

```bash
/home/apollo/clawd/web/link-vault
```

## Data File

Link data is stored in:

```bash
/home/apollo/clawd/links/links.json
```

## Run Locally

```bash
cd /home/apollo/clawd/web/link-vault
PORT=3090 npm start
```

Open:

```text
http://localhost:3090
```

## Pages

- `/` — home
- `/browse.html` — browse/manage links
- `/editor.html` — add/edit links

## Startup / Stop Scripts

### Start Link Vault

```bash
/home/apollo/clawd/web/link-vault/start-link-vault.sh
```

### Stop Link Vault

```bash
/home/apollo/clawd/web/link-vault/stop-link-vault.sh
```

The startup script checks whether port `3090` is already in use before starting.

## Batch Paste Format

Paste one link per line:

```text
https://www.youtube.com | YouTube
https://example.com/article | Example Article
https://example.com/no-title
```

## Clipboard Helper

On the editor page:

- click **Paste clipboard**
- if your clipboard contains a valid URL, it is inserted into the URL field
- then title fetch runs automatically

## Favicon

Favicon file:

```bash
/home/apollo/clawd/web/link-vault/public/favicon.ico
```

## Notes

This project is intentionally built with:

- Node.js built-in HTTP server
- plain HTML
- plain CSS
- plain JavaScript

No heavy frontend framework is used, so it stays easy to read and modify.
