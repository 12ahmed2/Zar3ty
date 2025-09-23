(function () {
  const k = 'client_fp';
  let v = localStorage.getItem(k);
  if (!v) {
    v = [...crypto.getRandomValues(new Uint8Array(16))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(k, v);
  }
  document.cookie = 'fp=' + v + '; Path=/; SameSite=Strict' + (location.protocol === 'https:' ? '; Secure' : '');
})();
