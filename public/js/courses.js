// =============================
// courses.js
// =============================

// Fetch all courses
async function fetchCourses() {
  try {
    const res = await fetch('/api/courses');
    if (!res.ok) throw new Error('Failed to fetch courses');
    return await res.json();
  } catch (err) {
    console.error('Error loading courses:', err);
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
function renderCourses(list, enrolledSet = new Set()) {
  const grid = document.getElementById("courses-grid");
  if (!list.length) {
    grid.innerHTML = `<div class="muted">No courses available.</div>`;
    return;
  }

  grid.innerHTML = list.map(c => {
    const enrolled = enrolledSet.has(Number(c.id));
    return `
      <div class="course-card">
        <img src="${c.image_url || 'https://via.placeholder.com/600x400'}" alt="${c.title}">
        <div class="course-content">
          <div class="course-title">${c.title}</div>
          <div class="course-desc">${c.description || ''}</div>
          <button class="btn enroll-btn"
            data-translate="courses.${enrolled ? 'unenroll' : 'enroll'}"
            data-course-id="${c.id}"
            data-enrolled="${enrolled}">
          </button>
          <button class="btn btn-secondary" data-course-id="${c.id}" data-translate="gradients.open"></button>
        </div>
      </div>`;
  }).join('');

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
