require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

function asyncRoute(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

async function requireBoard(req, res, next) {
  try {
    const board = await db.getBoard(req.params.boardId);
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    req.board = board;
    next();
  } catch (err) {
    next(err);
  }
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

// Delete a board (only the browser holding its owner token can do this)
app.delete(
  '/api/boards/:boardId',
  requireBoard,
  asyncRoute(async (req, res) => {
    const ownerToken = req.get('X-Owner-Token') || '';
    const deleted = await db.deleteBoard(req.board.id, ownerToken);
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
