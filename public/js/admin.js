const loginCard = document.getElementById('login-card');
const adminPanel = document.getElementById('admin-panel');
const logoutBtn = document.getElementById('logout-btn');
const loginError = document.getElementById('login-error');
const boardsTbody = document.getElementById('boards-tbody');
const boardCount = document.getElementById('board-count');
const filterInput = document.getElementById('admin-filter');

let allBoards = [];

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

function showLoggedIn(isLoggedIn) {
  loginCard.hidden = isLoggedIn;
  adminPanel.hidden = !isLoggedIn;
  logoutBtn.hidden = !isLoggedIn;
}

function fmtDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function render() {
  const filter = filterInput.value.trim().toLowerCase();
  const boards = allBoards.filter((b) => (b.title || '').toLowerCase().includes(filter));
  boardCount.textContent = `${boards.length} of ${allBoards.length} board${allBoards.length === 1 ? '' : 's'}`;

  boardsTbody.innerHTML = '';
  boards.forEach((board) => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';

    const isDeleted = !!board.deletedAt;

    tr.innerHTML = `
      <td style="padding:10px 8px; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
        ${isDeleted ? '<s>' : ''}${escapeHtml(board.title || 'Untitled board')}${isDeleted ? '</s>' : ''}
        <div style="color:var(--text-dim); font-size:12px;">${board.id}</div>
      </td>
      <td style="padding:10px 8px;">${board.noteCount}</td>
      <td style="padding:10px 8px;">${board.hasOwner ? 'Claimed' : 'Legacy'}</td>
      <td style="padding:10px 8px;">${fmtDate(board.updatedAt)}</td>
      <td style="padding:10px 8px;">${isDeleted ? `Deleted ${fmtDate(board.deletedAt)}` : 'Active'}</td>
      <td style="padding:10px 8px; white-space:nowrap;"></td>
    `;

    const actionsCell = tr.lastElementChild;

    const openBtn = document.createElement('a');
    openBtn.href = `/board/${board.id}`;
    openBtn.textContent = 'Open';
    openBtn.target = '_blank';
    openBtn.rel = 'noopener';
    openBtn.style.marginRight = '10px';
    actionsCell.appendChild(openBtn);

    if (isDeleted) {
      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'secondary';
      restoreBtn.textContent = 'Restore';
      restoreBtn.style.marginRight = '8px';
      restoreBtn.addEventListener('click', async () => {
        await api(`/api/admin/boards/${board.id}/restore`, { method: 'POST' });
        await loadBoards();
      });
      actionsCell.appendChild(restoreBtn);

      const purgeBtn = document.createElement('button');
      purgeBtn.type = 'button';
      purgeBtn.className = 'danger-btn';
      purgeBtn.textContent = 'Purge forever';
      purgeBtn.addEventListener('click', async () => {
        if (!confirm(`Permanently delete "${board.title || 'Untitled board'}"? This cannot be undone.`)) return;
        await api(`/api/admin/boards/${board.id}/purge`, { method: 'DELETE' });
        await loadBoards();
      });
      actionsCell.appendChild(purgeBtn);
    } else {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'delete-board-btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Delete "${board.title || 'Untitled board'}"? It can be restored later from here.`)) return;
        await api(`/api/boards/${board.id}`, { method: 'DELETE' });
        await loadBoards();
      });
      actionsCell.appendChild(deleteBtn);
    }

    boardsTbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadBoards() {
  allBoards = await api('/api/admin/boards');
  render();
}

async function checkSession() {
  const { authenticated } = await api('/api/admin/session');
  showLoggedIn(authenticated);
  if (authenticated) await loadBoards();
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const password = document.getElementById('admin-password').value;
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    document.getElementById('admin-password').value = '';
    showLoggedIn(true);
    await loadBoards();
  } catch (err) {
    loginError.textContent = err.status === 401 ? 'Incorrect password.' : 'Login is not available on this server.';
    loginError.hidden = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  showLoggedIn(false);
});

filterInput.addEventListener('input', render);

wireThemeToggle('theme-toggle');
checkSession();
