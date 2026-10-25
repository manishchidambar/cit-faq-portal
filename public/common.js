// Shared helpers used by every page.

// Escape text before putting it into HTML (prevents XSS from FAQ content).
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escaped text with search words wrapped in <mark>.
function highlight(text, query) {
  const safe = esc(text);
  const words = String(query || "").trim().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return safe;
  const pattern = new RegExp("(" + words.map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
  return safe.replace(pattern, "<mark>$1</mark>");
}

// fetch wrapper: returns JSON or throws an Error with the server's message.
async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || "Request failed (" + res.status + ")");
    err.status = res.status;
    throw err;
  }
  return data;
}

const CATEGORY_ICONS = {
  "Academics & Exams": "📘",
  "Placements & Careers": "💼",
  "Campus Life": "🎉",
  "Library": "📚",
  "Hostel & Facilities": "🏠",
  "About & Admissions": "🏛️",
};
function categoryIcon(name) {
  return CATEGORY_ICONS[name] || "💬";
}

// Mark the current page in the nav.
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.page === page) a.classList.add("active");
  });
});
