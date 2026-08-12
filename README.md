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

## Deploying on cPanel (Setup Node.js App)

cPanel runs Node apps through Phusion Passenger, and MySQL users created via cPanel are
scoped to a database you create yourself in the UI (they don't have `CREATE DATABASE`
privileges) — the app already handles that: it tries to create the database on startup
and just logs a warning and continues if it's not allowed to.

1. **Create the database** in cPanel → *MySQL Databases*: create a database (cPanel will
   prefix it, e.g. `cpanelusername_todo_keep`), a database user, and add that user to the
   database with **All Privileges**.
2. **Upload the code**: either `git clone` the repo into a directory under your account
   (e.g. via cPanel → *Git Version Control*, or SSH), or upload/extract a zip of this repo.
3. **Create the app** in cPanel → *Setup Node.js App*:
   - Node.js version: 18 or newer
   - Application mode: Production
   - Application root: the folder you uploaded to (e.g. `todo-keep`)
   - Application URL: the domain/subdomain you want it on
   - Application startup file: `server/index.js`
4. Click **Create**, then add these **Environment variables** in the same screen
   (use the values from step 1 — do not set `PORT`, Passenger injects that itself):
   - `DB_HOST` = `localhost`
   - `DB_PORT` = `3306`
   - `DB_USER` = `cpanelusername_dbuser`
   - `DB_PASSWORD` = the password you set
   - `DB_NAME` = `cpanelusername_todo_keep`
5. Click **Run NPM Install** on the app page (this installs `express`, `mysql2`,
   `socket.io`, etc. using cPanel's bundled Node/npm).
6. Click **Restart**. The app log on that page will show `Keep-style todo app running…`
   once it's up; open the Application URL to confirm.

Notes:
- Some shared-hosting reverse proxies don't support WebSocket upgrades. Socket.IO
  automatically falls back to HTTP long-polling in that case, so real-time sync keeps
  working — just with slightly higher latency.
- Whenever you deploy new code (e.g. after `git pull`), click **Restart** on the Setup
  Node.js App page so Passenger picks up the changes.
