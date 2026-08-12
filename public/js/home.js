function extractBoardId(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/board\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return trimmed;
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

document.getElementById('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = document.getElementById('board-link').value;
  const id = extractBoardId(raw);
  if (id) window.location.href = `/board/${id}`;
});
