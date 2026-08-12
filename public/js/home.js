const joinStatus = document.getElementById('join-status');
const joinResults = document.getElementById('join-results');

function extractBoardId(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/board\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return trimmed;
}

function showStatus(message) {
  joinStatus.textContent = message;
  joinStatus.hidden = !message;
}

function showResults(boards) {
  joinResults.innerHTML = '';
  joinResults.hidden = boards.length === 0;
  boards.forEach((board) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';

    const title = document.createElement('span');
    title.textContent = board.title || 'Untitled board';

    const meta = document.createElement('span');
    meta.className = 'result-meta';
    meta.textContent = `Last updated ${new Date(board.updatedAt).toLocaleString()}`;

    btn.append(title, meta);
    btn.addEventListener('click', () => {
      window.location.href = `/board/${board.id}`;
    });

    li.appendChild(btn);
    joinResults.appendChild(li);
  });
}

document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('board-title').value;
  const res = await fetch('/api/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const board = await res.json();
  window.location.href = `/board/${board.id}`;
});

document.getElementById('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showStatus('');
  showResults([]);

  const raw = document.getElementById('board-link').value;
  const id = extractBoardId(raw);
  if (!id) return;

  // A pasted link, or something that already looks like a valid board ID —
  // try opening it directly first.
  try {
    const res = await fetch(`/api/boards/${id}`);
    if (res.ok) {
      window.location.href = `/board/${id}`;
      return;
    }
  } catch {
    // network error — fall through to search
  }

  // Otherwise treat the input as a board name and search for it.
  try {
    const res = await fetch(`/api/boards/search?q=${encodeURIComponent(raw.trim())}`);
    const boards = await res.json();
    if (boards.length === 0) {
      showStatus('No board found with that name, link, or ID.');
    } else if (boards.length === 1) {
      window.location.href = `/board/${boards[0].id}`;
    } else {
      showStatus(`Found ${boards.length} boards named like "${raw.trim()}" — pick one:`);
      showResults(boards);
    }
  } catch {
    showStatus('Something went wrong searching for that board.');
  }
});
