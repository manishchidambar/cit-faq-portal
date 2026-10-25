// FAQ page: read-only list with live search, category filter and expandable answers.

const params = new URLSearchParams(window.location.search);
const state = {
  faqs: [],
  query: params.get("q") || "",
  category: params.get("category") || "All",
  open: new Set(),
};

const searchEl = document.getElementById("search");
const chipsEl = document.getElementById("chips");
const listEl = document.getElementById("list");
const countEl = document.getElementById("count");

searchEl.value = state.query;

function matches(faq) {
  if (state.category !== "All" && faq.category !== state.category) return false;
  const words = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = (faq.question + " " + faq.answer + " " + faq.category).toLowerCase();
  return words.every((w) => hay.includes(w));
}

function renderChips() {
  const cats = ["All", ...new Set(state.faqs.map((f) => f.category))];
  chipsEl.innerHTML = cats.map((c) => `
    <button class="chip ${c === state.category ? "active" : ""}" data-cat="${esc(c)}">
      ${c === "All" ? "All topics" : categoryIcon(c) + " " + esc(c)}
    </button>`).join("");
  chipsEl.querySelectorAll(".chip").forEach((b) => {
    b.addEventListener("click", () => {
      state.category = b.dataset.cat;
      renderChips();
      renderList();
      syncUrl();
    });
  });
}

function renderList() {
  const results = state.faqs.filter(matches);
  countEl.textContent = results.length + " of " + state.faqs.length + " questions";

  if (!results.length) {
    listEl.innerHTML = `
      <div class="card empty">
        <div class="big">🔍</div>
        <p><strong>No matching question found.</strong></p>
        <p>Try different words, choose "All topics", or contact the admin office at info@cambridge.edu.in.</p>
      </div>`;
    return;
  }

  // Auto-open the answer when the search narrows to a single result
  const autoOpen = results.length === 1;

  listEl.innerHTML = results.map((f) => {
    const isOpen = autoOpen || state.open.has(f.id);
    return `
      <div class="faq-item">
        <button class="faq-q" aria-expanded="${isOpen}" aria-controls="a-${esc(f.id)}" data-id="${esc(f.id)}">
          <span class="tag">${esc(f.category)}</span>
          <span class="qtext">${highlight(f.question, state.query)}</span>
        </button>
        <div class="faq-a" id="a-${esc(f.id)}" ${isOpen ? "" : "hidden"}>${highlight(f.answer, state.query)}</div>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".faq-q").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      document.getElementById("a-" + id).hidden = open;
      open ? state.open.delete(id) : state.open.add(id);
    });
  });
}

function syncUrl() {
  const p = new URLSearchParams();
  if (state.query) p.set("q", state.query);
  if (state.category !== "All") p.set("category", state.category);
  history.replaceState(null, "", "/faq" + (p.toString() ? "?" + p : ""));
}

let timer;
searchEl.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.query = searchEl.value;
    renderList();
    syncUrl();
  }, 120);
});

async function load() {
  try {
    state.faqs = await api("/api/faqs");
    if (state.category !== "All" && !state.faqs.some((f) => f.category === state.category)) {
      state.category = "All";
    }
    renderChips();
    renderList();
  } catch (err) {
    countEl.textContent = "";
    listEl.innerHTML = `<div class="card empty"><div class="big">⚠️</div><p>${esc(err.message)}</p></div>`;
  }
}

load();
