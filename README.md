# Link Vault

Link Vault is a minimalist website for saving, organizing, and reviewing useful links in a clean personal library.

## Purpose

The website is designed to make link saving feel structured instead of messy.

Instead of keeping random URLs in chats, notes, or browser tabs, Link Vault gives you a focused place to:

- save links clearly
- organize them with lightweight metadata
- review them later in a clean library view
- keep important links easy to find

It is built as a personal link management tool with a compact, low-noise interface.

## What the Website Does

Link Vault helps you manage links in three main ways:

### 1) Save links
You can add links individually from the editor page.

When adding a link, the website can:
- accept a pasted URL
- read from clipboard using the **Paste clipboard** helper
- fetch the page title automatically
- clean noisy tracking/auth parameters from URLs
- let you attach tags, notes, and status

### 2) Browse links
The browse page is designed like a compact library.

It lets you:
- search through saved links
- sort links
- group links by date
- pin important links
- edit or delete entries quickly
- scan links in a compact row layout

### 3) Import and export
The website supports lightweight bulk input and backup.

You can:
- export the saved link database as JSON
- batch import links by pasting multiple lines

## Main Pages

### Home
The home page gives a quick overview of the library.

It shows:
- total links
- unread links
- useful links
- shortcuts to key sections
- a recent links summary

### Browse
The browse page is the main library view.

It is optimized for:
- compact scanning
- quick management
- low visual clutter

Features include:
- search
- sorting
- date grouping
- pinned section
- inline edit/delete actions
- compact rows with metadata

### Add Link / Editor
The editor page is the focused input area for adding and editing links.

It supports:
- URL input
- clipboard paste helper
- title fetching
- date selection
- status selection
- tags
- notes
- batch paste import
- JSON export

## Core Features

### URL cleanup
When a link is added or processed, Link Vault cleans unnecessary URL parameters when possible.

This helps remove things like:
- tracking parameters
- marketing parameters
- large auth/callback query strings

The goal is to store cleaner and more durable links.

### Clipboard helper
The editor includes a **Paste clipboard** action.

If your clipboard contains a valid URL, the website can:
- insert it into the URL field
- then fetch the page title automatically

This makes saving copied links much faster.

### Title fetching
The website can fetch a page title from a URL.

This reduces manual typing and helps build a cleaner library automatically.

### Batch paste import
You can paste multiple links in a simple line-based format.

Example:

```text
https://www.youtube.com | YouTube
https://example.com/article | Example Article
https://example.com/no-title
```

This makes it easy to quickly add multiple links at once.

### Tags and notes
Each link can include:
- tags
- notes

This helps turn a saved URL into something more useful than a raw bookmark.

### Status system
Each link can have a status such as:
- saved
- unread
- useful
- archived

This helps give meaning to links instead of treating them all the same.

### Pinning
Links can be pinned so important items stay more visible.

Pinned links are visually distinguished and grouped separately in the browse view.

### Date grouping
The library groups entries using more human-friendly labels such as:
- Today
- Yesterday
- Earlier

This makes the collection easier to review over time.

## Design Approach

The website is intentionally designed to feel:
- minimalist
- tidy
- compact
- readable
- practical

It avoids a heavy dashboard style and instead behaves more like a focused working library.

The main design goal is to make link management:
- fast to use
- easy to scan
- visually calm
- structured without being complicated

## Summary

Link Vault is a personal link library website built to help you:
- save links quickly
- clean links automatically
- organize them with tags, notes, and status
- review them in a compact browse view
- keep important links pinned and easy to find
