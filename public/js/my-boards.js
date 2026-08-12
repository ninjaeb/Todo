// Tracks boards this browser created (and therefore "owns") in localStorage,
// since the app has no accounts/login. Each entry carries the secret owner
// token issued at creation time, which the server requires to delete a board.
const MyBoards = (() => {
  const KEY = 'todoKeepMyBoards';

  function list() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function save(boards) {
    try {
      localStorage.setItem(KEY, JSON.stringify(boards));
    } catch {
      // localStorage unavailable (private mode, quota, etc.) — ownership just won't persist.
    }
  }

  function add(board) {
    const boards = list().filter((b) => b.id !== board.id);
    boards.unshift({ id: board.id, title: board.title, ownerToken: board.ownerToken, createdAt: board.createdAt });
    save(boards);
  }

  function remove(id) {
    save(list().filter((b) => b.id !== id));
  }

  function updateTitle(id, title) {
    const boards = list();
    const entry = boards.find((b) => b.id === id);
    if (entry) {
      entry.title = title;
      save(boards);
    }
  }

  function get(id) {
    return list().find((b) => b.id === id) || null;
  }

  return { list, add, remove, updateTitle, get };
})();
