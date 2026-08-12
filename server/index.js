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

function now() {
  return new Date().toISOString();
}

function emptyBoard(title) {
  const id = nanoid(12);
  return {
    id,
    title: title && title.trim() ? title.trim() : 'Untitled board',
    createdAt: now(),
    updatedAt: now(),
    notes: [],
  };
}

function findNote(board, noteId) {
  return board.notes.find((n) => n.id === noteId);
}

function requireBoard(req, res, next) {
  const board = db.getBoard(req.params.boardId);
  if (!board) {
    return res.status(404).json({ error: 'Board not found' });
  }
  req.board = board;
  next();
}

// Create a new board
app.post('/api/boards', (req, res) => {
  const board = emptyBoard(req.body && req.body.title);
  db.saveBoard(board);
  res.status(201).json(board);
});

// Fetch a board (this is what the shared link loads)
app.get('/api/boards/:boardId', requireBoard, (req, res) => {
  res.json(req.board);
});

// Rename a board
app.put('/api/boards/:boardId', requireBoard, (req, res) => {
  const { title } = req.body || {};
  if (typeof title === 'string' && title.trim()) {
    req.board.title = title.trim();
    req.board.updatedAt = now();
    db.saveBoard(req.board);
    io.to(req.board.id).emit('board:renamed', { title: req.board.title, updatedAt: req.board.updatedAt });
  }
  res.json(req.board);
});

// Create a note (a checklist card) on a board
app.post('/api/boards/:boardId/notes', requireBoard, (req, res) => {
  const { title, color } = req.body || {};
  const note = {
    id: nanoid(10),
    title: typeof title === 'string' ? title : '',
    color: COLORS.includes(color) ? color : 'default',
    items: [],
    pinned: false,
    position: req.board.notes.length,
    createdAt: now(),
    updatedAt: now(),
  };
  req.board.notes.unshift(note);
  req.board.updatedAt = now();
  db.saveBoard(req.board);
  io.to(req.board.id).emit('note:created', note);
  res.status(201).json(note);
});

// Update a note (title, color, pinned, items, position)
app.put('/api/boards/:boardId/notes/:noteId', requireBoard, (req, res) => {
  const note = findNote(req.board, req.params.noteId);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  const { title, color, items, pinned, position } = req.body || {};
  if (typeof title === 'string') note.title = title;
  if (COLORS.includes(color)) note.color = color;
  if (typeof pinned === 'boolean') note.pinned = pinned;
  if (typeof position === 'number') note.position = position;
  if (Array.isArray(items)) {
    note.items = items.map((it) => ({
      id: it.id || nanoid(8),
      text: typeof it.text === 'string' ? it.text : '',
      checked: !!it.checked,
    }));
  }
  note.updatedAt = now();
  req.board.updatedAt = now();
  db.saveBoard(req.board);
  io.to(req.board.id).emit('note:updated', note);
  res.json(note);
});

// Delete a note
app.delete('/api/boards/:boardId/notes/:noteId', requireBoard, (req, res) => {
  const idx = req.board.notes.findIndex((n) => n.id === req.params.noteId);
  if (idx === -1) return res.status(404).json({ error: 'Note not found' });
  req.board.notes.splice(idx, 1);
  req.board.updatedAt = now();
  db.saveBoard(req.board);
  io.to(req.board.id).emit('note:deleted', { id: req.params.noteId });
  res.status(204).end();
});

// Fallback: send the board page for any /board/:id deep link
app.get('/board/:boardId', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'board.html'));
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

server.listen(PORT, () => {
  console.log(`Keep-style todo app running at http://localhost:${PORT}`);
});
