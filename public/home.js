// Home page: hero search, topic tiles and popular questions, all loaded from /api/faqs.

const POPULAR_CODES = ["CIT004", "CIT002", "CIT009", "CIT018", "CIT001"];

document.getElementById("heroSearch").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = document.getElementById("heroQuery").value.trim();
  window.location.href = "/faq" + (q ? "?q=" + encodeURIComponent(q) : "");
});

async function loadHome() {
  const topics = document.getElementById("topics");
  const popular = document.getElementById("popular");
  try {
    const faqs = await api("/api/faqs");

    // Count FAQs per category
    const counts = {};
    faqs.forEach((f) => { counts[f.category] = (counts[f.category] || 0) + 1; });
    const cats = Object.keys(counts);

    document.getElementById("statFaqs").textContent = faqs.length;
    document.getElementById("statCats").textContent = cats.length;

    topics.innerHTML = cats.map((c) => `
      <a class="card tile" href="/faq?category=${encodeURIComponent(c)}">
        <div class="icon">${categoryIcon(c)}</div>
        <h3>${esc(c)}</h3>
        <p>${counts[c]} question${counts[c] === 1 ? "" : "s"}</p>
      </a>`).join("");

    // Popular: preferred codes first, then fill with the earliest FAQs
    let picks = POPULAR_CODES.map((code) => faqs.find((f) => f.code === code)).filter(Boolean);
    if (picks.length < 5) picks = picks.concat(faqs.filter((f) => !picks.includes(f)).slice(0, 5 - picks.length));

    popular.innerHTML = picks.map((f, i) => `
      <div class="faq-item">
        <button class="faq-q" aria-expanded="false" aria-controls="pa${i}">
          <span class="tag">${esc(f.category)}</span>
          <span class="qtext">${esc(f.question)}</span>
        </button>
        <div class="faq-a" id="pa${i}" hidden>${esc(f.answer)}</div>
      </div>`).join("");

    popular.querySelectorAll(".faq-q").forEach((btn) => {
      btn.addEventListener("click", () => {
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        document.getElementById(btn.getAttribute("aria-controls")).hidden = open;
      });
    });
  } catch (err) {
    const msg = `<div class="card empty"><div class="big">⚠️</div><p>${esc(err.message)}</p></div>`;
    topics.innerHTML = msg;
    popular.innerHTML = "";
    document.getElementById("statFaqs").textContent = "-";
    document.getElementById("statCats").textContent = "-";
  }
}

loadHome();
