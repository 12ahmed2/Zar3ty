// =============================
// lang.js
// =============================

// Load and apply a language file
window.loadLanguage = async function (lang) {
  try {
    // Fetch the JSON file for this language
    const res = await fetch(`/static/lang/lang.${lang}.json`);
    const data = await res.json();

    // Store current language & data globally
    window.currentLang = lang;
    window.currentLangData = data;

    // Apply translations immediately
    translatePage(data);

    // Change direction (rtl/ltr) automatically
    document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';

    // Save selected language in localStorage
    localStorage.setItem('lang', lang);
  } catch (err) {
    console.error(`Error loading language ${lang}:`, err);
  }
};

// Apply translation to every element with [data-translate]
function translatePage(data) {
  document.querySelectorAll('[data-translate]').forEach(el => {
    const key = el.getAttribute('data-translate');
    const val = key.split('.').reduce((o, k) => (o || {})[k], data);
    if (val) el.textContent = val;
  });
}

// Observe DOM changes so translations apply automatically
const observer = new MutationObserver(mutations => {
  mutations.forEach(mutation => {
    if (mutation.type === 'attributes' && mutation.attributeName === 'data-translate') {
      // Attribute changed → retranslate
      translatePage(window.currentLangData || {});
    } else if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          // If the added node has data-translate
          if (node.hasAttribute && node.hasAttribute('data-translate')) {
            translatePage(window.currentLangData || {});
          } else if (node.querySelectorAll) {
            // Or if any child has data-translate
            if (node.querySelectorAll('[data-translate]').length > 0) {
              translatePage(window.currentLangData || {});
            }
          }
        }
      });
    }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  // Load language from localStorage or default to 'en'
  const lang = localStorage.getItem('lang') || 'en';
  window.loadLanguage(lang);

  // Start watching for new elements AND attribute changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-translate']
  });

  // Handle <select id="lang-switcher">
  const langSelect = document.getElementById('lang-switcher');
  if (langSelect) {
    // Set dropdown to saved lang
    langSelect.value = lang;

    // Switch language when user selects a different option
    langSelect.addEventListener('change', e => {
      window.loadLanguage(e.target.value);
    });
  }

});
