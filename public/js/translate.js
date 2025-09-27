export function detectLanguage(text) {
  const arabic = /[\u0600-\u06FF]/;
  const english = /[A-Za-z]/;

  if (arabic.test(text)) {
    return "ar"; // Arabic
  } else if (english.test(text)) {
    return "en"; // English
  } else {
    return "unknown"; // لو مش عربي ولا إنجليزي
  }
}


export async function translate(text, src, dest) {
  const response = await fetch(
    `http://127.0.0.1:5000/translate?text=${encodeURIComponent(text)}&src=${src}&dest=${dest}`,
    { method: "GET" }
  );

  const data = await response.json();
  return data.translated_text;
}


