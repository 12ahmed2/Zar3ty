// =============================
// courses.js
// =============================


import {detectLanguage,translate} from './translate.js';


const LANG = localStorage.getItem('lang') || 'en';


// Fetch all courses
async function fetchCourses() {
  try {
    const res = await fetch('/api/courses');
    if (!res.ok) throw new Error(detectLanguage('Failed to fetch courses') === LANG? 'Failed to fetch courses': await translate('Failed to fetch courses', detectLanguage('Failed to fetch courses'), LANG));
    return await res.json();
  } catch (err) {
    console.error(detectLanguage('Error loading courses:') === LANG? 'Error loading courses:': await translate('Error loading courses:', detectLanguage('Error loading courses:'), LANG), err);
    return [];
  }
}

// Fetch my enrollments
async function fetchMyEnrollments() {
  // returns [{ course_id, enrolled_at, ... }, ...] when logged in
  const res = await fetch('/api/me/enrollments', { credentials: 'include' });
  if (!res.ok) return []; // not logged in or no enrollments
  return res.json();
}

// Render courses grid
async function renderCourses(list, enrolledSet = new Set()) {
  const grid = document.getElementById("courses-grid");
  if (!list.length) {
    grid.innerHTML = `<div class="muted" data-translate="courses.noCourses"></div>`;
    return;
  }

  const htmlList = await Promise.all(list.map(async c => {
    const enrolled = enrolledSet.has(Number(c.id));

    // Translate asynchronously
    const title = detectLanguage(c.title) === LANG ? c.title : await translate(c.title, detectLanguage(c.title), LANG);
    const description = detectLanguage(c.description || '') === LANG ? c.description : await translate(c.description, detectLanguage(c.description), LANG);

    return `
      <div class="course-card">
        <img src="${c.image_url || 'https://via.placeholder.com/600x400'}" alt="${title}">
        <div class="course-content">
          <div class="course-title">${title}</div>
          <div class="course-desc">${description || ''}</div>
          <button class="btn enroll-btn"
            data-translate="courses.${enrolled ? 'unenroll' : 'enroll'}"
            data-course-id="${c.id}"
            data-enrolled="${enrolled}">
          </button>
          <button class="btn btn-secondary" data-course-id="${c.id}" data-translate="gradients.open"></button>
        </div>
      </div>`;
  }));
  grid.innerHTML = htmlList.join('');


  // Attach click handlers after rendering
  document.querySelectorAll(".enroll-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const button = e.currentTarget;
      const courseId = button.dataset.courseId;
      const enrolled = button.dataset.enrolled === 'true';

      try {
        const res = await fetch(`/api/courses/${courseId}/enroll`, {
          method: enrolled ? 'DELETE' : 'POST',
          credentials: 'include'
        });
        if (!res.ok) {
          const data = await res.json().catch(()=>({ error: res.statusText }));
          throw new Error(data.error || res.statusText);
        }

        // toggle UI state
        const newEnrolled = !enrolled;
        button.dataset.enrolled = newEnrolled.toString();

        // ✅ Instead of hardcoding textContent,
        // update the data-translate attribute so lang.js updates text instantly
        button.setAttribute(
          'data-translate',
          newEnrolled ? 'courses.unenroll' : 'courses.enroll'
        );

        // ⚠️ Do NOT set textContent manually;
        // lang.js observer will update text automatically in current language
      } catch (err) {
        console.error('Enroll/unenroll failed', err);
        alert('Action failed. See console.');
      }
    });
  });

  document.querySelectorAll(".btn-secondary").forEach(el=> {
    el.addEventListener("click", async (e) => {
      const butt = e.currentTarget;
      const courseId = butt.dataset.courseId;
      window.location.href = `/course/${courseId}`;
    });
  });

}

// Initial load
(async () => {
  try {
    const [courses, myEnrollments] = await Promise.all([
      fetchCourses(),
      fetchMyEnrollments().catch(()=>[])
    ]);
    const enrolledSet = new Set((myEnrollments || []).map(x => Number(x.course_id)));
    renderCourses(courses, enrolledSet);
  } catch (err) {
    console.error('Boot error:', err);
    alert('An error occurred. Check console.');
  }
})();
