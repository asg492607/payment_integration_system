
  function toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const nextTheme = isLight ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
    
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = nextTheme === 'light' ? '🌙' : '🌞';
  }

  // Init theme
  const currentTheme = localStorage.getItem('theme') || 'light'; // Default to light per user request
  document.documentElement.setAttribute('data-theme', currentTheme);
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.textContent = currentTheme === 'light' ? '🌙' : '🌞';
