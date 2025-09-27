// Utility to fetch JSON with optional body and credentials
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


// Get course ID from URL path
function courseIdFromPath() {
  const parts = location.pathname.split('/').filter(Boolean);
  return Number(parts[parts.length-1]);
}


async function downloadCertificate(me,courseId) {
  try {
    // Load user and course
    const course = await fetchJson(`/api/courses/${courseId}`);
    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: "a4"
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Light green background (farm-friendly)
    doc.setFillColor(240, 248, 240); 
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    // Dark green border
    doc.setDrawColor(34, 139, 34); 
    doc.setLineWidth(5);
    doc.rect(20, 20, pageWidth-40, pageHeight-40);

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(32);
    doc.setTextColor(34, 139, 34);
    doc.text("Certificate of Completion", pageWidth/2, 120, { align: "center" });

    // Subtitle
    doc.setFont("helvetica", "normal");
    doc.setFontSize(18);
    doc.setTextColor(60, 60, 60);
    doc.text("This certifies that", pageWidth/2, 180, { align: "center" });

    // Farmer’s name
    doc.setFont("times", "bolditalic");
    doc.setFontSize(28);
    doc.setTextColor(0, 0, 0);
    doc.text(me.fullname , pageWidth/2, 230, { align: "center" });

    // Course info
    doc.setFont("helvetica", "normal");
    doc.setFontSize(18);
    doc.text("has successfully completed the training course:", pageWidth/2, 280, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(34, 139, 34);
    doc.text(course.title || "Farming Course", pageWidth/2, 320, { align: "center" });

    // Date
    const today = new Date().toLocaleDateString();
    doc.setFont("helvetica", "italic");
    doc.setFontSize(14);
    doc.setTextColor(80, 80, 80);
    doc.text(`Date: ${today}`, pageWidth/2, 370, { align: "center" });

    // Footer (organization)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(34, 139, 34);
    doc.text("Temple of Trades Academy", pageWidth/2, 420, { align: "center" });

    // Save
    doc.save(`${me.fullname|| "user"}_${course.title || "course"}_certificate.pdf`);

  } catch (err) {
    console.error("Error generating certificate:", err);
    alert("Failed to generate certificate.");
  }
}


async function showCertificateButton(courseId) {
  const certBtn = document.getElementById("certificate-btn");
  certBtn.style.display = 'inline-block';

  const me = await api('/api/me').catch(() => null);

  certBtn.onclick = () => downloadCertificate(me,courseId);

  // append under course title (or change target as you like)
  const container = document.getElementById("course-header") || document.body;
  container.appendChild(certBtn);
}

// Parse YouTube video ID from URL or raw input
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

// UI references
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

// Load YouTube API
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
    setTimeout(() => { if (!resolved) resolve(null); }, timeoutMs);
  });
  return YTready;
}

// State
let COURSE = null;
let players = [];
let ADMIN_COMPLETED = false;

// Fetch admin completion
async function fetchAdminCompletedOnce(courseId) {
  try {
    const res = await fetch(`/api/course/${courseId}/completedcourse`, { credentials: 'include' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || res.statusText);
    }

    const data = await res.json();
    // Safely check if first row exists and has completed_course
    ADMIN_COMPLETED = Array.isArray(data) && data.length > 0 ? !!data[0].completed_course : false;

  } catch (err) {
    console.error('Error fetching admin completion:', err);
    ADMIN_COMPLETED = false;
  }
}


// Check if user completed course
function isUserCompleted(course) {
  if (!ADMIN_COMPLETED) return false;
  if (!course.modules || !Array.isArray(course.modules)) return false;
  if (!course.progress || !course.progress.watched) return false;

  for (let mi = 0; mi < course.modules.length; mi++) {
    const module = course.modules[mi];
    const vids = module.videos || [];
    const watched = course.progress.watched[`m${mi}`] || [];
    for (let vi = 0; vi < vids.length; vi++) {
      if (!watched.includes(vi)) return false;
    }
  }
  return true;
}

// Mark a video as watched
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

    const vidEl = document.querySelector(`[data-mod="${module_idx}"][data-vid="${video_idx}"]`);
    if (vidEl) vidEl.classList.add('watched');

    if (isUserCompleted(COURSE)) showCompletedBadge();

    return res;
  } catch (err) {
    console.error('markWatched error', err);
    return null;
  }
}

// Enroll/unenroll user
async function setEnroll(courseId, enroll) {
  try {
    if (enroll) {
      await fetchJson(`/api/courses/${courseId}/enroll`, { method: 'POST' });
      COURSE.enrolled = true;
      el.enrollBtn.dataset.translate = 'courses.unenroll';
      el.enrollBtn.textContent = '';
      el.enrollBtn.dataset.enrolled = 'true';
      el.enrollBtn.setAttribute('aria-pressed', 'true');
    } else {
      await fetchJson(`/api/courses/${courseId}/enroll`, { method: 'DELETE' });
      COURSE.enrolled = false;
      el.enrollBtn.dataset.translate = 'courses.enroll';
      el.enrollBtn.textContent = '';
      el.enrollBtn.dataset.enrolled = 'false';
      el.enrollBtn.setAttribute('aria-pressed', 'false');
    }
    if (window.applyTranslations) window.applyTranslations();
  } catch (err) {
    console.error('enroll error', err);
  }
}

// Show completed badge
function showCompletedBadge() {
  const h1 = el.title;
  if (!h1) return;
  if (!h1.querySelector('.badge')) {
    h1.appendChild(badge('Completed'));
  }
}

// Render course UI
async function renderCourse(course) {
  COURSE = course;
  await fetchAdminCompletedOnce(course.id);

  el.title.textContent = course.title || 'Untitled course';
  el.desc.textContent = course.description || '';
  el.img.src = course.image_url || '/static/img/placeholder-course.png';

  if (el.enrollBtn) {
    el.enrollBtn.dataset.enrolled = course.enrolled ? 'true' : 'false';
    el.enrollBtn.dataset.translate = course.enrolled ? 'courses.unenroll' : 'courses.enroll';
    el.enrollBtn.textContent = '';
    el.enrollBtn.setAttribute('aria-pressed', course.enrolled ? 'true' : 'false');
    
  el.enrollBtn.onclick = async () => {
    // Use COURSE.enrolled, not dataset
    await setEnroll(course.id, !COURSE.enrolled);
  };

    if (window.applyTranslations) window.applyTranslations();
  }

  if (isUserCompleted(course)){
    showCompletedBadge();
    showCertificateButton(course.id);
  }

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

      title.addEventListener('click', async () => {
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

// Check if user is logged in
async function isLoggedIn() {
  try {
    const r = await fetch('/api/me', { credentials: 'include' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Bootstrapping course page
(async function bootCourse() {
  try {
    const id = courseIdFromPath();
    const me = await isLoggedIn().catch(() => null);
    let course = await fetchJson(`/api/courses/${id}`, { method: 'GET' });

    // If user is logged in, check enrollment
    if (me) {
      try {
        const enrolls = await fetchJson('/api/me/enrollments', { method: 'GET' });
        const e = Array.isArray(enrolls) ? enrolls.find(x => Number(x.course_id) === Number(id)) : null;
        if (e) {
          course.enrolled = true;
          course.progress = e.meta || course.progress || { watched: {} };
        } else {
          course.enrolled = false;
          course.progress = { watched: {} };
        }
      } catch (e) {
        console.warn('Could not load enrollments fallback', e);
        course.enrolled = !!course.enrolled;
      }
    }

    // Render course page
    if (el.enrollBtn) {
      // Setup enroll button click
      el.enrollBtn.onclick = async () => {
  try {
      if (!await isLoggedIn()) {
      alert("You need to log in first to enroll in a course.");
      window.location.href = "/login"; // redirect to login page
      return;
    }
    // Use the local course object, not COURSE (may be null)
    await setEnroll(course.id, !course.enrolled);

    // Update local state
    course.enrolled = !course.enrolled;

    // After enrollment, render course content
    if (course.enrolled) {
      await renderCourse(course); // sets COURSE internally
    } else {
      clearNode(el.modulesList);
      const info = document.createElement('div');
      info.className = 'course-info';
      info.innerHTML = `<p class="muted">You must enroll to access the course content.</p>
                        <p>This course has <strong>${Array.isArray(course.modules) ? course.modules.length : 0}</strong> modules.</p>`;
      el.modulesList.appendChild(info);
    }
    
  } catch (err) {
    console.error('Enroll button click error', err);
  }
};

    }

    // Render course content if already enrolled
    if (course.enrolled) {
      await renderCourse(course);
    } else {
      clearNode(el.modulesList);
      const info = document.createElement('div');
      info.className = 'course-info';
      info.innerHTML = `<p class="muted">You must enroll to access the course content.</p>
                        <p>This course has <strong>${Array.isArray(course.modules) ? course.modules.length : 0}</strong> modules.</p>`;
      el.modulesList.appendChild(info);
    }
    
  } catch (err) {
    console.error('Failed loading course', err);
    const root = document.getElementById('course-page') || document.body;
    root.innerHTML = '<div class="muted">Failed to load course.</div>';
  }
})();
