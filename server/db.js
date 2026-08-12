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
      owner_token VARCHAR(32) NOT NULL,
      deleted_at DATETIME(3) NULL DEFAULT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Older deployments may already have a boards table predating a given column.
  async function ensureColumn(name, ddl) {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'boards' AND COLUMN_NAME = ?`,
      [DB_NAME, name]
    );
    if (rows.length === 0) {
      await pool.query(`ALTER TABLE boards ADD COLUMN ${ddl}`);
    }
  }
  await ensureColumn('owner_token', "owner_token VARCHAR(32) NOT NULL DEFAULT ''");
  await ensureColumn('deleted_at', 'deleted_at DATETIME(3) NULL DEFAULT NULL');

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
    // Whether *some* browser holds this board's owner token — never the
    // token itself. Boards created before ownership existed have an empty
    // owner_token, so hasOwner is false and anyone can still delete them,
    // preserving the old "link = full access" behavior for those boards.
    hasOwner: !!boardRow.owner_token,
    deletedAt: boardRow.deleted_at,
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

async function createBoard(id, title, ownerToken) {
  const now = new Date();
  await pool.query('INSERT INTO boards (id, title, owner_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    title,
    ownerToken,
    now,
    now,
  ]);
  return { id, title, ownerToken, createdAt: now, updatedAt: now, notes: [] };
}

// Soft-deletes (sets deleted_at) a board if the given token matches its
// owner_token, OR if the board has no owner_token at all (a board created
// before ownership existed, back when the share link alone granted full
// access — those stay deletable by anyone with the link). Returns false for
// a missing/already-deleted board or a real token mismatch.
async function deleteBoard(boardId, ownerToken) {
  const [result] = await pool.query(
    "UPDATE boards SET deleted_at = NOW(3) WHERE id = ? AND deleted_at IS NULL AND (owner_token = '' OR owner_token = ?)",
    [boardId, ownerToken || '']
  );
  return result.affectedRows > 0;
}

// Same as deleteBoard, but bypasses the owner-token check entirely — for the
// admin, who may manage any board regardless of who created it.
async function adminSoftDeleteBoard(boardId) {
  const [result] = await pool.query('UPDATE boards SET deleted_at = NOW(3) WHERE id = ? AND deleted_at IS NULL', [
    boardId,
  ]);
  return result.affectedRows > 0;
}

async function restoreBoard(boardId) {
  const [result] = await pool.query('UPDATE boards SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL', [
    boardId,
  ]);
  return result.affectedRows > 0;
}

// Irreversibly removes a board and its notes (cascades via FK). Admin-only.
async function purgeBoard(boardId) {
  const [result] = await pool.query('DELETE FROM boards WHERE id = ?', [boardId]);
  return result.affectedRows > 0;
}

async function listAllBoardsForAdmin() {
  const [rows] = await pool.query(`
    SELECT b.id, b.title, b.owner_token, b.deleted_at, b.created_at, b.updated_at,
           COUNT(n.id) AS note_count
    FROM boards b
    LEFT JOIN notes n ON n.board_id = b.id
    GROUP BY b.id
    ORDER BY (b.deleted_at IS NOT NULL), b.updated_at DESC
  `);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    hasOwner: !!row.owner_token,
    noteCount: row.note_count,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function getBoard(boardId, { includeDeleted = false } = {}) {
  const [boardRows] = await pool.query(
    `SELECT * FROM boards WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
    [boardId]
  );
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
    'SELECT id, title, updated_at FROM boards WHERE deleted_at IS NULL AND title LIKE ? ORDER BY updated_at DESC LIMIT ?',
    [`%${query}%`, limit]
  );
  return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));
}

module.exports = {
  initSchema,
  createBoard,
  getBoard,
  renameBoard,
  deleteBoard,
  adminSoftDeleteBoard,
  restoreBoard,
  purgeBoard,
  listAllBoardsForAdmin,
  createNote,
  updateNote,
  deleteNote,
  searchBoardsByTitle,
};
