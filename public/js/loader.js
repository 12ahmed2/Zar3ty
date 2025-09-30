// loader.js
(function injectLoader() {
  // Create loader HTML
  const loader = document.createElement('div');
  loader.id = 'site-loader';
loader.innerHTML = `
  <style>
    #site-loader {
      position: fixed;
      inset: 0;
      background: #fff;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 999999;
      transition: opacity 0.5s ease;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    #site-loader.hidden {
      opacity: 0;
      pointer-events: none;
    }
    #site-loader h1 {
      font-size: 5rem;
      font-weight: 700;
      color: #2c3e50;
      margin-bottom: 20px;
      letter-spacing: 2px;
    }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #3498db;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
  <div id="site-loader">
    <h1 data-translate="navbar.title"></h1>
    <div class="spinner"></div>
  </div>
`;


  // Insert into DOM
  document.body.appendChild(loader);

  // Hide loader when page fully loaded
  window.addEventListener('load', () => {
    setTimeout(() => {
      loader.classList.add('hidden');
      setTimeout(() => loader.remove(), 600); // remove after fade out
    }, 300); // small delay for smoother effect
  });
})();
