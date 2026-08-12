const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

const boardId = window.location.pathname.split('/board/')[1];
if (!boardId) window.location.href = '/';

const state = { board: null, openNoteId: null, detailEl: null };

const grid = document.getElementById('notes-grid');
const emptyState = document.getElementById('empty-state');
const boardTitleInput = document.getElementById('board-title-input');
const presenceEl = document.getElementById('presence');
const noteTemplate = document.getElementById('note-template').firstElementChild;

let draggedRow = null;

function autosizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function debounce(fn, delay) {
  const timers = new Map();
  return (key, ...args) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => fn(...args), delay));
  };
}

const debouncedNotePut = debounce((noteId, payload) => putNote(noteId, payload), 450);
const debouncedBoardRename = debounce((title) => renameBoard(title), 500);

function boardGone() {
  alert('This board no longer exists.');
  window.location.href = '/';
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const error = new Error(`Request failed: ${res.status}`);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

function putNote(noteId, payload) {
  return api(`/api/boards/${boardId}/notes/${noteId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }).catch((err) => {
    if (err.status === 404) {
      // Someone else deleted this note — drop it locally, the board itself is fine.
      state.board.notes = state.board.notes.filter((n) => n.id !== noteId);
      renderAll();
    }
  });
}

function renameBoard(title) {
  return api(`/api/boards/${boardId}`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  }).catch((err) => {
    if (err.status === 404) boardGone();
  });
}

function sortedNotes() {
  return [...state.board.notes].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

// Merge a note payload from the server into local state, preserving the
// existing note/item object identities wherever possible. Every field on a
// note the caller is actively typing into (title, or one item's text) keeps
// its local, not-yet-saved value rather than being clobbered by a snapshot
// that predates that edit — this is what lets two people type in different
// parts of the same note at the same time without losing keystrokes.
function mergeNote(incoming) {
  const existing = state.board.notes.find((n) => n.id === incoming.id);
  if (!existing) {
    state.board.notes.unshift(incoming);
    return incoming;
  }

  const noteEl = grid.querySelector(`[data-note-id="${incoming.id}"]`);
  const titleInput = noteEl?.querySelector('.note-title');
  const focusedItemId =
    noteEl && noteEl.contains(document.activeElement)
      ? document.activeElement.closest('.note-item')?.dataset.itemId
      : null;

  if (!titleInput || document.activeElement !== titleInput) {
    existing.title = incoming.title;
  }
  existing.color = incoming.color;
  existing.pinned = incoming.pinned;
  existing.position = incoming.position;
  existing.createdAt = incoming.createdAt;
  existing.updatedAt = incoming.updatedAt;

  const existingItemsById = new Map(existing.items.map((it) => [it.id, it]));
  existing.items = incoming.items.map((incomingItem) => {
    const existingItem = existingItemsById.get(incomingItem.id);
    if (existingItem) {
      if (existingItem.id !== focusedItemId) {
        existingItem.text = incomingItem.text;
        existingItem.checked = incomingItem.checked;
      }
      return existingItem;
    }
    return incomingItem;
  });

  return existing;
}

function syncItemsContainer(container, items, note, el) {
  // Don't fight an in-progress drag reorder within this same container.
  if (draggedRow && draggedRow.parentElement === container) return;

  const existingRows = new Map([...container.children].map((child) => [child.dataset.itemId, child]));
  const usedIds = new Set();

  items.forEach((item) => {
    usedIds.add(item.id);
    const text = item.text || '';
    let row = existingRows.get(item.id);
    if (!row) {
      row = buildItemRow(note, item, el);
      container.appendChild(row);
      autosizeTextarea(row.querySelector('textarea'));
      return;
    }

    const checkbox = row.querySelector('input[type="checkbox"]');
    const textarea = row.querySelector('.item-text');
    if (document.activeElement !== checkbox) checkbox.checked = !!item.checked;
    row.classList.toggle('checked', !!item.checked);
    if (document.activeElement !== textarea && textarea.value !== text) {
      textarea.value = text;
      autosizeTextarea(textarea);
    }
    container.appendChild(row); // reorders without losing focus/state
  });

  existingRows.forEach((row, id) => {
    if (!usedIds.has(id)) row.remove();
  });
}

function getDragAfterElement(container, y) {
  const rows = [...container.querySelectorAll('.note-item:not(.dragging)')];
  return rows.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function persistItemOrder(note, el) {
  const itemsContainer = el.querySelector('.note-items');
  const orderedIds = [...itemsContainer.children].map((row) => row.dataset.itemId);
  const byId = new Map(note.items.map((it) => [it.id, it]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(reordered.map((it) => it.id));
  note.items.forEach((it) => {
    if (!seen.has(it.id)) reordered.push(it);
  });
  note.items = reordered;
  putNote(note.id, { items: note.items });
}

function renderAll() {
  if (document.activeElement !== boardTitleInput) boardTitleInput.value = state.board.title;
  document.title = `${state.board.title} · Todo Keep`;

  const notes = sortedNotes();
  emptyState.hidden = notes.length > 0;

  const existingIds = new Set(notes.map((n) => n.id));
  [...grid.children].forEach((child) => {
    if (!existingIds.has(child.dataset.noteId)) child.remove();
  });

  notes.forEach((note) => {
    let el = grid.querySelector(`[data-note-id="${note.id}"]`);
    if (!el) {
      el = buildNoteElement(note);
      grid.appendChild(el);
      // Textareas sized while el was detached (no layout) read scrollHeight as 0;
      // re-run autosize now that it's actually in the document.
      el.querySelectorAll('textarea').forEach(autosizeTextarea);
    } else {
      updateNoteElement(el, note);
    }
  });

  if (state.openNoteId) {
    const openNote = state.board.notes.find((n) => n.id === state.openNoteId);
    if (!openNote) {
      closeNoteDetail();
    } else if (state.detailEl) {
      updateNoteElement(state.detailEl, openNote);
    }
  }
}

function buildNoteElement(note) {
  const el = noteTemplate.cloneNode(true);
  el.dataset.noteId = note.id;
  wireNoteElement(el, note);
  updateNoteElement(el, note);
  return el;
}

function openNoteDetail(noteId) {
  const note = state.board.notes.find((n) => n.id === noteId);
  if (!note) return;
  state.openNoteId = noteId;
  // Un-hide the modal BEFORE building/autosizing its content — a textarea
  // inside a display:none ancestor always reports scrollHeight 0, which is
  // exactly the "note opens but everything looks blank" bug.
  document.getElementById('note-detail-modal').hidden = false;
  const container = document.getElementById('note-detail-content');
  container.innerHTML = '';
  state.detailEl = buildNoteElement(note);
  container.appendChild(state.detailEl);
  state.detailEl.querySelectorAll('textarea').forEach(autosizeTextarea);
}

function closeNoteDetail() {
  state.openNoteId = null;
  state.detailEl = null;
  document.getElementById('note-detail-modal').hidden = true;
}

function wireNoteElement(el, note) {
  const titleInput = el.querySelector('.note-title');
  titleInput.addEventListener('input', () => {
    note.title = titleInput.value;
    autosizeTextarea(titleInput);
    socket.emit('title:typing', { noteId: note.id, title: note.title });
    debouncedNotePut(note.id, { title: note.title });
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  // Drag-to-reorder for active items.
  const itemsContainer = el.querySelector('.note-items');
  itemsContainer.addEventListener('dragover', (e) => {
    if (!draggedRow || draggedRow.parentElement !== itemsContainer) return;
    e.preventDefault();
    const after = getDragAfterElement(itemsContainer, e.clientY);
    if (after == null) itemsContainer.appendChild(draggedRow);
    else itemsContainer.insertBefore(draggedRow, after);
  });
  itemsContainer.addEventListener('drop', (e) => {
    // Persisting happens in the drag handle's dragend handler, which fires
    // reliably regardless of whether the browser also dispatches "drop" —
    // this listener just prevents the browser's default drop behavior.
    if (draggedRow) e.preventDefault();
  });

  // Click the card background (not a control) to open the larger detail view.
  // Only wired for grid cards — the detail modal reuses this same builder, so
  // skip it there to avoid a click inside the modal trying to reopen itself.
  el.addEventListener('click', (e) => {
    if (el.closest('#note-detail-content')) return;
    if (e.target.closest('input, textarea, button')) return;
    openNoteDetail(note.id);
  });

  const addForm = el.querySelector('.add-item-form');
  const addInput = el.querySelector('.add-item-input');
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = addInput.value.trim();
    if (!text) return;
    note.items.push({ id: `local-${Date.now()}`, text, checked: false });
    addInput.value = '';
    updateNoteElement(el, note);
    putNote(note.id, { items: note.items });
  });

  const completedToggle = el.querySelector('.completed-toggle');
  completedToggle.addEventListener('click', () => {
    el.dataset.completedExpanded = el.dataset.completedExpanded === 'true' ? 'false' : 'true';
    updateNoteElement(el, note);
  });

  const pinBtn = el.querySelector('.pin-btn');
  pinBtn.addEventListener('click', () => {
    note.pinned = !note.pinned;
    updateNoteElement(el, note);
    putNote(note.id, { pinned: note.pinned });
    renderAll();
  });

  const deleteBtn = el.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this list?')) return;
    el.remove();
    await api(`/api/boards/${boardId}/notes/${note.id}`, { method: 'DELETE' }).catch(() => {});
    state.board.notes = state.board.notes.filter((n) => n.id !== note.id);
    renderAll();
  });

  const swatches = el.querySelector('.color-swatches');
  COLORS.forEach((color) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.dataset.color = color;
    btn.title = color;
    btn.addEventListener('click', () => {
      note.color = color;
      el.dataset.color = color;
      swatches.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('selected', s.dataset.color === color));
      putNote(note.id, { color });
    });
    swatches.appendChild(btn);
  });
}

function buildItemRow(note, item, el) {
  const row = document.createElement('div');
  row.className = `note-item${item.checked ? ' checked' : ''}`;
  row.dataset.itemId = item.id;

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.title = 'Drag to reorder';
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => {
    draggedRow = row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  });
  handle.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    draggedRow = null;
    // dragend always fires (even if a "drop" event doesn't land on a valid
    // target), so persisting here — rather than only in a "drop" handler —
    // reliably saves the reorder regardless of exactly how the drag ended.
    persistItemOrder(note, el);
  });

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !!item.checked;
  checkbox.addEventListener('change', () => {
    item.checked = checkbox.checked;
    updateNoteElement(el, note);
    putNote(note.id, { items: note.items });
  });

  const text = document.createElement('textarea');
  text.rows = 1;
  text.className = 'item-text';
  text.value = item.text || '';
  text.placeholder = 'List item';
  text.addEventListener('input', () => {
    item.text = text.value;
    autosizeTextarea(text);
    socket.emit('item:typing', { noteId: note.id, itemId: item.id, text: item.text });
    debouncedNotePut(note.id, { items: note.items });
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-item-btn';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    note.items = note.items.filter((it) => it.id !== item.id);
    updateNoteElement(el, note);
    putNote(note.id, { items: note.items });
  });

  row.append(handle, checkbox, text, removeBtn);
  return row;
}

function updateNoteElement(el, note) {
  el.dataset.color = note.color || 'default';

  const titleInput = el.querySelector('.note-title');
  if (document.activeElement !== titleInput) titleInput.value = note.title || '';
  autosizeTextarea(titleInput);

  const pinBtn = el.querySelector('.pin-btn');
  pinBtn.classList.toggle('active', !!note.pinned);

  el.querySelectorAll('.swatch').forEach((s) => {
    s.classList.toggle('selected', s.dataset.color === (note.color || 'default'));
  });

  const itemsContainer = el.querySelector('.note-items');
  const completedContainer = el.querySelector('.completed-items');
  const completedToggle = el.querySelector('.completed-toggle');

  const activeItems = note.items.filter((item) => !item.checked);
  const completedItems = note.items.filter((item) => item.checked);
  const expanded = el.dataset.completedExpanded === 'true';

  // Un-hide BEFORE building/autosizing rows inside it — same bug class as the
  // detail modal: a textarea inside a display:none ancestor always reports
  // scrollHeight 0, so autosizing it while still hidden leaves it looking
  // empty even though its value is set correctly.
  completedContainer.hidden = !expanded;

  syncItemsContainer(itemsContainer, activeItems, note, el);
  if (expanded) {
    syncItemsContainer(completedContainer, completedItems, note, el);
  } else {
    completedContainer.innerHTML = '';
  }

  completedToggle.hidden = completedItems.length === 0;
  completedToggle.classList.toggle('expanded', expanded);
  completedToggle.querySelector('.completed-count').textContent = `${completedItems.length} completed item${completedItems.length === 1 ? '' : 's'}`;
}

function applyBoardUpdate(board) {
  state.board = board;
  setUpDeleteBoardButton(board);
  renderAll();
}

async function loadBoard() {
  try {
    const board = await api(`/api/boards/${boardId}`);
    applyBoardUpdate(board);
  } catch (err) {
    if (err.status === 404) return boardGone();
    console.error(err);
  }
}

document.getElementById('new-note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('new-note-title');
  const title = input.value.trim();
  input.value = '';
  try {
    const note = await api(`/api/boards/${boardId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    mergeNote(note);
    renderAll();
  } catch (err) {
    if (err.status === 404) return boardGone();
    console.error(err);
  }
});

boardTitleInput.addEventListener('input', () => {
  state.board.title = boardTitleInput.value;
  document.title = `${state.board.title || 'Untitled board'} · Todo Keep`;
  MyBoards.updateTitle(boardId, boardTitleInput.value);
  debouncedBoardRename(boardTitleInput.value);
});

wireThemeToggle('theme-toggle');

const deleteBoardBtn = document.getElementById('delete-board-btn');

// Runs once board data has actually loaded, since eligibility depends on
// board.hasOwner (unknown until then) as well as local ownership tracking.
function setUpDeleteBoardButton(board) {
  const owned = MyBoards.get(boardId);
  // Show the button if this browser holds the real owner token, or if the
  // board predates the ownership feature entirely (hasOwner false) — those
  // stay manageable by anyone with the link, same as before this shipped.
  const canDelete = !!owned || board.hasOwner === false;
  if (!canDelete) return;

  deleteBoardBtn.hidden = false;
  deleteBoardBtn.addEventListener('click', async () => {
    if (!confirm('Delete this entire board and everything on it? This cannot be undone.')) return;
    try {
      await api(`/api/boards/${boardId}`, {
        method: 'DELETE',
        headers: { 'X-Owner-Token': owned ? owned.ownerToken : '' },
      });
      MyBoards.remove(boardId);
      window.location.href = '/';
    } catch (err) {
      alert('Could not delete this board.');
      console.error(err);
    }
  });
}

const noteDetailModal = document.getElementById('note-detail-modal');
document.getElementById('close-detail-btn').addEventListener('click', closeNoteDetail);
noteDetailModal.addEventListener('click', (e) => {
  if (e.target === noteDetailModal) closeNoteDetail();
});

const shareModal = document.getElementById('share-modal');
const shareLinkInput = document.getElementById('share-link-input');

document.getElementById('share-btn').addEventListener('click', () => {
  shareLinkInput.value = window.location.href;
  shareModal.hidden = false;
  shareLinkInput.select();
});

document.getElementById('close-modal-btn').addEventListener('click', () => {
  shareModal.hidden = true;
});

document.getElementById('copy-link-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    const btn = document.getElementById('copy-link-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = original), 1500);
  } catch {
    shareLinkInput.select();
    document.execCommand('copy');
  }
});

shareModal.addEventListener('click', (e) => {
  if (e.target === shareModal) shareModal.hidden = true;
});

// ---------- Realtime ----------
const socket = io();

socket.on('connect', () => {
  socket.emit('board:join', boardId);
});

socket.on('presence:count', (count) => {
  presenceEl.textContent = `👀 ${count}`;
});

function findNoteInstances(noteId) {
  const els = [];
  const gridEl = grid.querySelector(`[data-note-id="${noteId}"]`);
  if (gridEl) els.push(gridEl);
  if (state.openNoteId === noteId && state.detailEl) els.push(state.detailEl);
  return els;
}

// Live keystroke previews from other viewers — ephemeral, never touches the
// database (the debounced PUT each typist sends is what actually persists).
socket.on('item:typing', ({ noteId, itemId, text }) => {
  if (!state.board) return;
  const note = state.board.notes.find((n) => n.id === noteId);
  const item = note?.items.find((it) => it.id === itemId);
  if (!item) return;
  item.text = text;
  findNoteInstances(noteId).forEach((noteEl) => {
    const textarea = noteEl.querySelector(`.note-item[data-item-id="${itemId}"] .item-text`);
    if (textarea && document.activeElement !== textarea) {
      textarea.value = text;
      autosizeTextarea(textarea);
    }
  });
});

socket.on('title:typing', ({ noteId, title }) => {
  if (!state.board) return;
  const note = state.board.notes.find((n) => n.id === noteId);
  if (!note) return;
  note.title = title;
  findNoteInstances(noteId).forEach((noteEl) => {
    const titleInput = noteEl.querySelector('.note-title');
    if (titleInput && document.activeElement !== titleInput) {
      titleInput.value = title;
      autosizeTextarea(titleInput);
    }
  });
});

socket.on('note:created', (note) => {
  if (!state.board) return;
  mergeNote(note);
  renderAll();
});

socket.on('note:updated', (note) => {
  if (!state.board) return;
  mergeNote(note);
  renderAll();
});

socket.on('note:deleted', ({ id }) => {
  if (!state.board) return;
  state.board.notes = state.board.notes.filter((n) => n.id !== id);
  renderAll();
});

socket.on('board:renamed', ({ title }) => {
  if (!state.board) return;
  state.board.title = title;
  if (document.activeElement !== boardTitleInput) boardTitleInput.value = title;
  document.title = `${title} · Todo Keep`;
  MyBoards.updateTitle(boardId, title);
});

socket.on('board:deleted', () => {
  MyBoards.remove(boardId);
  alert('This board was deleted.');
  window.location.href = '/';
});

loadBoard();
