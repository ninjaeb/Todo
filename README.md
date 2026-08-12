# Todo Keep

A Google Keep–style todo board you can share by link and collaborate on in real time.

## Features

- Create a board and get a shareable link (`/board/:id`) — anyone with the link can view and edit
- Add multiple todo lists ("notes") per board, each with its own checklist items
- Check off items, edit titles/items inline, pick a note color, pin important lists, delete lists
- Real-time sync across everyone viewing the same board (via WebSockets), with a live viewer count
- No login required — data persists on the server (JSON file storage)

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:3000, create a board, and share the URL with collaborators.

## Tech

- Node.js + Express for the HTTP API and static file serving
- Socket.IO for real-time collaboration between everyone viewing a board
- Plain HTML/CSS/JS frontend (no build step)
- Simple JSON-file persistence in `data/db.json`
