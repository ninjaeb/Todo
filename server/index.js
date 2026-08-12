require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const db = require('./db');
const adminAuth = require('./adminAuth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SESSION_COOKIE = 'admin_session';

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  req.isAdmin = adminAuth.isValidSession(req.cookies?.[ADMIN_SESSION_COOKIE]);
  next();
});
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    // "no-cache" (not "no-store"): browsers may keep a copy, but must
    // revalidate with the server (via ETag) before using it. This is what
    // stops deployed JS/CSS fixes from getting stuck behind a stale cached
    // copy — without it, some browsers/proxies keep serving old assets for
    // a long time after a redeploy even on a hard refresh.
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

function asyncRoute(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

async function requireBoard(req, res, next) {
  try {
    // An authenticated admin can open/edit a board even after it's been
    // soft-deleted (e.g. to review it before restoring or purging).
    const board = await db.getBoard(req.params.boardId, { includeDeleted: req.isAdmin });
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    req.board = board;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

// Create a new board
app.post(
  '/api/boards',
  asyncRoute(async (req, res) => {
    const title = req.body && req.body.title && req.body.title.trim() ? req.body.title.trim() : 'Untitled board';
    const ownerToken = nanoid(24);
    const board = await db.createBoard(nanoid(12), title, ownerToken);
    res.status(201).json(board);
  })
);

// Search boards by title (must be registered before the /:boardId route below,
// otherwise Express would treat "search" itself as a boardId).
app.get(
  '/api/boards/search',
  asyncRoute(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) return res.json([]);
    const results = await db.searchBoardsByTitle(query, 10);
    res.json(results);
  })
);

// Fetch a board (this is what the shared link loads)
app.get('/api/boards/:boardId', requireBoard, (req, res) => {
  res.json(req.board);
});

// Rename a board
app.put(
  '/api/boards/:boardId',
  requireBoard,
  asyncRoute(async (req, res) => {
    const { title } = req.body || {};
    if (typeof title === 'string' && title.trim()) {
      const { title: newTitle, updatedAt } = await db.renameBoard(req.board.id, title.trim());
      io.to(req.board.id).emit('board:renamed', { title: newTitle, updatedAt });
      req.board.title = newTitle;
      req.board.updatedAt = updatedAt;
    }
    res.json(req.board);
  })
);

// Soft-delete a board (owner token required, unless the admin is doing it —
// the admin can delete/restore/purge any board regardless of ownership)
app.delete(
  '/api/boards/:boardId',
  requireBoard,
  asyncRoute(async (req, res) => {
    const deleted = req.isAdmin
      ? await db.adminSoftDeleteBoard(req.board.id)
      : await db.deleteBoard(req.board.id, req.get('X-Owner-Token') || '');
    if (!deleted) return res.status(403).json({ error: 'Not authorized to delete this board' });
    io.to(req.board.id).emit('board:deleted');
    res.status(204).end();
  })
);

// Create a note (a checklist card) on a board
app.post(
  '/api/boards/:boardId/notes',
  requireBoard,
  asyncRoute(async (req, res) => {
    const { title, color } = req.body || {};
    const note = await db.createNote(req.board.id, {
      id: nanoid(10),
      title: typeof title === 'string' ? title : '',
      color: COLORS.includes(color) ? color : 'default',
      items: [],
      pinned: false,
      position: req.board.notes.length,
    });
    io.to(req.board.id).emit('note:created', note);
    res.status(201).json(note);
  })
);

// Update a note (title, color, pinned, items, position)
app.put(
  '/api/boards/:boardId/notes/:noteId',
  requireBoard,
  asyncRoute(async (req, res) => {
    const { title, color, items, pinned, position } = req.body || {};
    const fields = {};
    if (typeof title === 'string') fields.title = title;
    if (COLORS.includes(color)) fields.color = color;
    if (typeof pinned === 'boolean') fields.pinned = pinned;
    if (typeof position === 'number') fields.position = position;
    if (Array.isArray(items)) {
      fields.items = items.map((it) => ({
        id: it.id || nanoid(8),
        text: typeof it.text === 'string' ? it.text : '',
        checked: !!it.checked,
      }));
    }

    const note = await db.updateNote(req.board.id, req.params.noteId, fields);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    io.to(req.board.id).emit('note:updated', note);
    res.json(note);
  })
);

// Delete a note
app.delete(
  '/api/boards/:boardId/notes/:noteId',
  requireBoard,
  asyncRoute(async (req, res) => {
    const deleted = await db.deleteNote(req.board.id, req.params.noteId);
    if (!deleted) return res.status(404).json({ error: 'Note not found' });
    io.to(req.board.id).emit('note:deleted', { id: req.params.noteId });
    res.status(204).end();
  })
);

// ---------- Admin ----------

app.post(
  '/api/admin/login',
  asyncRoute(async (req, res) => {
    if (!ADMIN_PASSWORD) {
      return res.status(500).json({ error: 'Admin login is not configured on this server (set ADMIN_PASSWORD).' });
    }
    const { password } = req.body || {};
    if (typeof password !== 'string' || !adminAuth.timingSafeEqual(password, ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    const token = adminAuth.createSession();
    res.cookie(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true });
  })
);

app.post('/api/admin/logout', (req, res) => {
  const token = req.cookies?.[ADMIN_SESSION_COOKIE];
  if (token) adminAuth.destroySession(token);
  res.clearCookie(ADMIN_SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: !!req.isAdmin });
});

app.get(
  '/api/admin/boards',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await db.listAllBoardsForAdmin());
  })
);

app.post(
  '/api/admin/boards/:boardId/restore',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const restored = await db.restoreBoard(req.params.boardId);
    if (!restored) return res.status(404).json({ error: 'Board not found or not deleted' });
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/boards/:boardId/purge',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const purged = await db.purgeBoard(req.params.boardId);
    if (!purged) return res.status(404).json({ error: 'Board not found' });
    res.status(204).end();
  })
);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Fallback: send the board page for any /board/:id deep link
app.get('/board/:boardId', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'board.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const presence = new Map(); // boardId -> Set of socket ids

io.on('connection', (socket) => {
  let joinedBoard = null;

  socket.on('board:join', (boardId) => {
    if (!boardId) return;
    joinedBoard = boardId;
    socket.join(boardId);
    if (!presence.has(boardId)) presence.set(boardId, new Set());
    presence.get(boardId).add(socket.id);
    io.to(boardId).emit('presence:count', presence.get(boardId).size);
  });

  // Ephemeral live-typing relay: mirrors keystrokes to other viewers of the
  // same board instantly, ahead of the debounced PUT that actually persists
  // them. Never touches the database — just a same-room broadcast.
  socket.on('item:typing', (payload) => {
    if (!joinedBoard) return;
    if (!payload || typeof payload.noteId !== 'string' || typeof payload.itemId !== 'string' || typeof payload.text !== 'string') return;
    if (payload.text.length > 20000) return;
    socket.to(joinedBoard).emit('item:typing', payload);
  });

  socket.on('title:typing', (payload) => {
    if (!joinedBoard) return;
    if (!payload || typeof payload.noteId !== 'string' || typeof payload.title !== 'string') return;
    if (payload.title.length > 2000) return;
    socket.to(joinedBoard).emit('title:typing', payload);
  });

  socket.on('disconnect', () => {
    if (joinedBoard && presence.has(joinedBoard)) {
      presence.get(joinedBoard).delete(socket.id);
      io.to(joinedBoard).emit('presence:count', presence.get(joinedBoard).size);
    }
  });
});

async function start() {
  await db.initSchema();
  server.listen(PORT, () => {
    console.log(`Keep-style todo app running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
