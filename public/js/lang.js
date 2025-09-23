window.loadLanguage = async function(lang) {
  const res = await fetch(`/static/lang/lang.${lang}.json`);
  const data = await res.json();

  // Replace all elements with data-translate
  document.querySelectorAll('[data-translate]').forEach(el => {
    const key = el.getAttribute('data-translate');
    const val = key.split('.').reduce((o, k) => (o || {})[k], data);
    if (val) el.textContent = val;
  });

  // Change dir attribute if needed (also done in navbar.js, but safe to do again)
  document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';
};

// On page load, choose language from localStorage or default to 'en'
document.addEventListener('DOMContentLoaded', () => {
  const lang = localStorage.getItem('lang') || 'en';
  window.loadLanguage(lang);
});