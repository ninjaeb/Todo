function wireThemeToggle(buttonId) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;

  function render() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  }

  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('todoKeepTheme', next);
    } catch {
      // ignore
    }
    render();
  });

  render();
}
