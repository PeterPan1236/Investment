(() => {
  try {
    const savedTheme = localStorage.getItem('investment_theme');
    const validSavedTheme = savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = validSavedTheme || (prefersDark ? 'dark' : 'light');
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
  }
})();
