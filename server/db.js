const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { boards: {} };
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    if (!raw.trim()) return { boards: {} };
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read db.json, starting fresh:', err.message);
    return { boards: {} };
  }
}

let state = load();
let writeQueued = false;

function persist() {
  if (writeQueued) return;
  writeQueued = true;
  setImmediate(() => {
    writeQueued = false;
    const tmpPath = `${DB_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    fs.renameSync(tmpPath, DB_PATH);
  });
}

function getBoard(boardId) {
  return state.boards[boardId] || null;
}

function saveBoard(board) {
  state.boards[board.id] = board;
  persist();
}

function deleteBoard(boardId) {
  delete state.boards[boardId];
  persist();
}

module.exports = { getBoard, saveBoard, deleteBoard };
