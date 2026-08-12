# Todo Keep

A Google Keep–style todo board you can share by link and collaborate on in real time.

## Features

- Create a board and get a shareable link (`/board/:id`) — anyone with the link can view and edit
- Add multiple todo lists ("notes") per board, each with its own checklist items
- Check off items, edit titles/items inline, pick a note color, pin important lists, delete lists
- Real-time sync across everyone viewing the same board (via WebSockets), with a live viewer count
- No login required — data persists in MySQL

## Run locally

1. Make sure you have a MySQL server running and reachable.
2. Copy `.env.example` to `.env` and fill in your MySQL connection details (the app will create the `todo_keep` database and its tables automatically on first start if they don't exist).

```bash
cp .env.example .env
npm install
npm start
```

Then open http://localhost:3000, create a board, and share the URL with collaborators.

## Tech

- Node.js + Express for the HTTP API and static file serving
- Socket.IO for real-time collaboration between everyone viewing a board
- Plain HTML/CSS/JS frontend (no build step)
- MySQL persistence via `mysql2` (schema auto-created on startup)
