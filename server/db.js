const mysql = require('mysql2/promise');

const {
  DB_HOST = 'localhost',
  DB_PORT = '3306',
  DB_USER = 'root',
  DB_PASSWORD = '',
  DB_NAME = 'todo_keep',
} = process.env;

let pool;

async function initSchema() {
  // Try to create the database if it doesn't exist yet. Managed hosts (e.g. cPanel)
  // usually grant DB users privileges scoped to a database they pre-created via their
  // control panel UI, without CREATE DATABASE rights — so a denial here is expected
  // and we just proceed assuming DB_NAME already exists.
  try {
    const bootstrap = await mysql.createConnection({
      host: DB_HOST,
      port: Number(DB_PORT),
      user: DB_USER,
      password: DB_PASSWORD,
    });
    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4`);
    await bootstrap.end();
  } catch (err) {
    console.warn(
      `Skipping automatic database creation (${err.code || err.message}). ` +
        `Assuming database "${DB_NAME}" already exists.`
    );
  }

  pool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS boards (
      id VARCHAR(32) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id VARCHAR(32) PRIMARY KEY,
      board_id VARCHAR(32) NOT NULL,
      title TEXT,
      color VARCHAR(20) NOT NULL DEFAULT 'default',
      items JSON NOT NULL,
      pinned TINYINT(1) NOT NULL DEFAULT 0,
      position INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      CONSTRAINT fk_notes_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      INDEX idx_notes_board (board_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

function rowToBoard(boardRow, noteRows) {
  return {
    id: boardRow.id,
    title: boardRow.title,
    createdAt: boardRow.created_at,
    updatedAt: boardRow.updated_at,
    notes: noteRows.map(rowToNote),
  };
}

function rowToNote(row) {
  return {
    id: row.id,
    title: row.title || '',
    color: row.color,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
    pinned: !!row.pinned,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createBoard(id, title) {
  const now = new Date();
  await pool.query('INSERT INTO boards (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    id,
    title,
    now,
    now,
  ]);
  return { id, title, createdAt: now, updatedAt: now, notes: [] };
}

async function getBoard(boardId) {
  const [boardRows] = await pool.query('SELECT * FROM boards WHERE id = ?', [boardId]);
  if (boardRows.length === 0) return null;
  const [noteRows] = await pool.query(
    'SELECT * FROM notes WHERE board_id = ? ORDER BY pinned DESC, created_at DESC',
    [boardId]
  );
  return rowToBoard(boardRows[0], noteRows);
}

async function renameBoard(boardId, title) {
  const now = new Date();
  await pool.query('UPDATE boards SET title = ?, updated_at = ? WHERE id = ?', [title, now, boardId]);
  return { title, updatedAt: now };
}

async function createNote(boardId, note) {
  const now = new Date();
  await pool.query(
    `INSERT INTO notes (id, board_id, title, color, items, pinned, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      note.id,
      boardId,
      note.title,
      note.color,
      JSON.stringify(note.items),
      note.pinned ? 1 : 0,
      note.position,
      now,
      now,
    ]
  );
  await pool.query('UPDATE boards SET updated_at = ? WHERE id = ?', [now, boardId]);
  return { ...note, createdAt: now, updatedAt: now };
}

async function updateNote(boardId, noteId, fields) {
  const [rows] = await pool.query('SELECT * FROM notes WHERE id = ? AND board_id = ?', [noteId, boardId]);
  if (rows.length === 0) return null;
  const existing = rowToNote(rows[0]);

  const next = {
    title: typeof fields.title === 'string' ? fields.title : existing.title,
    color: fields.color || existing.color,
    items: Array.isArray(fields.items) ? fields.items : existing.items,
    pinned: typeof fields.pinned === 'boolean' ? fields.pinned : existing.pinned,
    position: typeof fields.position === 'number' ? fields.position : existing.position,
  };
  const now = new Date();

  await pool.query(
    `UPDATE notes SET title = ?, color = ?, items = ?, pinned = ?, position = ?, updated_at = ?
     WHERE id = ? AND board_id = ?`,
    [next.title, next.color, JSON.stringify(next.items), next.pinned ? 1 : 0, next.position, now, noteId, boardId]
  );
  await pool.query('UPDATE boards SET updated_at = ? WHERE id = ?', [now, boardId]);

  return { id: noteId, ...next, createdAt: existing.createdAt, updatedAt: now };
}

async function deleteNote(boardId, noteId) {
  const [result] = await pool.query('DELETE FROM notes WHERE id = ? AND board_id = ?', [noteId, boardId]);
  if (result.affectedRows === 0) return false;
  await pool.query('UPDATE boards SET updated_at = ? WHERE id = ?', [new Date(), boardId]);
  return true;
}

async function searchBoardsByTitle(query, limit = 10) {
  const [rows] = await pool.query(
    'SELECT id, title, updated_at FROM boards WHERE title LIKE ? ORDER BY updated_at DESC LIMIT ?',
    [`%${query}%`, limit]
  );
  return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));
}

module.exports = {
  initSchema,
  createBoard,
  getBoard,
  renameBoard,
  createNote,
  updateNote,
  deleteNote,
  searchBoardsByTitle,
};
