// public/js/course.js
// Inline playback: prefer YouTube IFrame API (to detect ended). Fallback to embedded iframe + manual "Mark watched".

async function fetchJson(url, opts = {}) {
  opts.credentials = opts.credentials || 'include';
  if (opts.json !== undefined) {
    opts.method = opts.method || 'POST';
    opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(opts.json);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

function courseIdFromPath() {
  const parts = location.pathname.split('/').filter(Boolean);
  return Number(parts[parts.length-1]);
}

function parseYouTubeId(input) {
  if (!input) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input}`);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  const m = input.match(/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* UI refs */
const el = {
  root: document.getElementById('course-page'),
  title: document.getElementById('course-title'),
  desc: document.getElementById('course-desc'),
  img: document.getElementById('course-image'),
  enrollBtn: document.getElementById('enroll-btn'),
  modulesList: document.getElementById('modules-list'),
};

function clearNode(n){ while(n && n.firstChild) n.removeChild(n.firstChild); }
function badge(text){
  const s = document.createElement('span');
  s.className = 'badge';
  s.textContent = text;
  return s;
}

/* YT API loader */
let YTready = null;
function loadYouTubeAPI(timeoutMs = 5000) {
  if (YTready) return YTready;
  YTready = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.head.appendChild(tag);
    let resolved = false;
    window.onYouTubeIframeAPIReady = () => { resolved = true; resolve(window.YT); };
    setTimeout(() => {
      if (!resolved) resolve(null); // indicate API not available within timeout
    }, timeoutMs);
  });
  return YTready;
}

/* state */
let COURSE = null;
let players = []; // store YT.Player instances for cleanup

async function markWatched(courseId, module_idx, video_idx) {
  try {
    const res = await fetchJson(`/api/courses/${courseId}/progress`, {
      method: 'POST',
      json: { module_idx: Number(module_idx), video_idx: Number(video_idx) }
    });
    COURSE.progress = COURSE.progress || { watched: {} };
    const key = `m${module_idx}`;
    COURSE.progress.watched[key] = COURSE.progress.watched[key] || [];
    if (!COURSE.progress.watched[key].includes(Number(video_idx))) {
      COURSE.progress.watched[key].push(Number(video_idx));
    }
    if (res.completed) {
      COURSE.completed_at = new Date().toISOString();
      showCompletedBadge();
    }
    const vidEl = document.querySelector(`[data-mod="${module_idx}"][data-vid="${video_idx}"]`);
    if (vidEl) vidEl.classList.add('watched');
    return res;
  } catch (err) {
    console.error('markWatched error', err);
    return null;
  }
}

async function setEnroll(courseId, enroll) {
  try {
    if (enroll) {
      await fetchJson(`/api/courses/${courseId}/enroll`, { method: 'POST' });
      COURSE.enrolled = true;
      // ✅ language-ready
      el.enrollBtn.dataset.translate = 'courses.unenroll';
      el.enrollBtn.textContent = ''; // lang.js will fill
      el.enrollBtn.dataset.enrolled = 'true';
      el.enrollBtn.setAttribute('aria-pressed', 'true');
    } else {
      await fetchJson(`/api/courses/${courseId}/enroll`, { method: 'DELETE' });
      COURSE.enrolled = false;
      // ✅ language-ready
      el.enrollBtn.dataset.translate = 'courses.enroll';
      el.enrollBtn.textContent = '';
      el.enrollBtn.dataset.enrolled = 'false';
      el.enrollBtn.setAttribute('aria-pressed', 'false');
    }
    // trigger lang.js to update immediately
    if (window.applyTranslations) window.applyTranslations();
  } catch (err) {
    console.error('enroll error', err);
    alert(err.data?.error || 'Enroll action failed');
  }
}

function showCompletedBadge() {
  const h1 = el.title;
  if (!h1) return;
  if (!h1.querySelector('.badge')) {
    h1.appendChild(badge('Completed'));
  }
}

/* Render */
async function renderCourse(course) {
  COURSE = course;
  el.title.textContent = course.title || 'Untitled course';
  el.desc.textContent = course.description || '';
  el.img.src = course.image_url || '/static/img/placeholder-course.png';

  if (el.enrollBtn) {
    el.enrollBtn.dataset.enrolled = course.enrolled ? 'true' : 'false';
    // ✅ language-ready
    el.enrollBtn.dataset.translate = course.enrolled ? 'courses.unenroll' : 'courses.enroll';
    el.enrollBtn.textContent = ''; // lang.js will fill
    el.enrollBtn.setAttribute('aria-pressed', course.enrolled ? 'true' : 'false');
    el.enrollBtn.onclick = async () => {
      const enrolled = el.enrollBtn.dataset.enrolled === 'true';
      await setEnroll(course.id, !enrolled);
    };
    if (window.applyTranslations) window.applyTranslations();
  }

  if (course.completed_at) showCompletedBadge();

  clearNode(el.modulesList);
  players.forEach(p => { try { p.destroy && p.destroy(); } catch {} });
  players = [];

  const modules = Array.isArray(course.modules) ? course.modules : [];
  const YT = await loadYouTubeAPI();

  modules.forEach((m, mi) => {
    const section = document.createElement('section');
    section.className = 'module-card';
    section.innerHTML = `<h3 class="module-title">${m.title || 'Module ' + (mi+1)}</h3><div class="videos" data-mod="${mi}"></div>`;
    el.modulesList.appendChild(section);

    const vidsContainer = section.querySelector('.videos');

    (m.videos || []).forEach((v, vi) => {
      const vidId = parseYouTubeId(v.url || v.video_id || v.id || '');
      const watched = !!(course.progress && course.progress.watched &&
                         Array.isArray(course.progress.watched[`m${mi}`]) &&
                         course.progress.watched[`m${mi}`].includes(vi));

      const card = document.createElement('div');
      card.className = 'video-card';
      card.dataset.mod = mi;
      card.dataset.vid = vi;

      const title = document.createElement('div');
      title.className = 'video-title';
      title.textContent = v.title || `Video ${vi+1}`;
      title.style.cursor = 'pointer';

      const controls = document.createElement('div');
      controls.className = 'video-controls';

      const mark = document.createElement('span');
      mark.className = 'watched-mark';
      mark.textContent = watched ? '✓' : '';
      controls.appendChild(mark);

      card.appendChild(title);
      card.appendChild(controls);
      if (watched) card.classList.add('watched');
      vidsContainer.appendChild(card);

      // click to toggle or create player
      title.addEventListener('click', async () => {
        // if player-wrap exists toggle visibility
        const existing = card.querySelector('.player-wrap');
        if (existing) {
          existing.style.display = existing.style.display === 'none' ? 'block' : 'none';
          return;
        }

        const playerWrap = document.createElement('div');
        playerWrap.className = 'player-wrap';
        card.insertBefore(playerWrap, controls);

        if (!vidId) {
          playerWrap.innerHTML = `<div class="muted">No playable video.</div>`;
          return;
        }

        // If YT API loaded use it to detect ends and auto-mark watched.
        if (YT && YT.Player) {
          try {
            const container = document.createElement('div');
            const uniq = `yt-player-${mi}-${vi}-${Date.now()}`;
            container.id = uniq;
            playerWrap.appendChild(container);
            const player = new YT.Player(uniq, {
              videoId: vidId,
              width: '100%',
              height: '360',
              playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
              events: {
                onStateChange: async (e) => {
                  if (e.data === YT.PlayerState.ENDED) {
                    await markWatched(course.id, mi, vi);
                    mark.textContent = '✓';
                    card.classList.add('watched');
                  }
                }
              }
            });
            players.push(player);
            return;
          } catch (err) {
            console.warn('YT player failed, falling back to iframe', err);
          }
        }

        // Fallback: embed iframe (plays inline) and provide a manual "Mark watched" button
        const iframe = document.createElement('iframe');
        iframe.width = '100%';
        iframe.height = '360';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
        iframe.allowFullscreen = true;
        iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(vidId)}?rel=0&modestbranding=1&playsinline=1`;
        playerWrap.appendChild(iframe);

        const manualBtn = document.createElement('button');
        manualBtn.className = 'btn sm mt-8';
        manualBtn.type = 'button';
        // ✅ language-ready for mark watched
        manualBtn.dataset.translate = 'courses.markWatched';
        manualBtn.textContent = '';
        manualBtn.addEventListener('click', async () => {
          await markWatched(course.id, mi, vi);
          mark.textContent = '✓';
          card.classList.add('watched');
          manualBtn.disabled = true;
        });
        playerWrap.appendChild(manualBtn);
        if (window.applyTranslations) window.applyTranslations();
      });
    });

    const header = section.querySelector('.module-title');
    header.addEventListener('click', () => section.classList.toggle('active'));
  });
}

/* bootstrap */
async function isLoggedIn() {
  try {
    const r = await fetch('/api/me', { credentials: 'include' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

(async function bootCourse() {
  try {
    const id = courseIdFromPath();
    const me = await isLoggedIn().catch(()=>null);
    const course = await fetchJson(`/api/courses/${id}`, { method: 'GET' });

    if (me) {
      try {
        const enrolls = await fetchJson('/api/me/enrollments', { method: 'GET' });
        const e = (Array.isArray(enrolls) ? enrolls.find(x => Number(x.course_id) === Number(id)) : null);
        if (e) {
          course.enrolled = true;
          course.progress = e.meta || course.progress || { watched: {} };
          if (e.completed_at) course.completed_at = e.completed_at;
        } else {
          course.enrolled = !!course.enrolled;
        }
      } catch (e) {
        console.warn('Could not load enrollments fallback', e);
      }
    }

    await renderCourse(course);
  } catch (err) {
    console.error('Failed loading course', err);
    const root = document.getElementById('course-page') || document.body;
    root.innerHTML = '<div class="muted">Failed to load course.</div>';
  }
})();
