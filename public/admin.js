// Admin page: login, add FAQ, edit FAQ, bulk upload from Excel.
// Every write goes through /api/admin/*, which the server protects with a signed session cookie.

const $ = (id) => document.getElementById(id);
let faqs = [];
let pendingRows = [];

function showMsg(el, text, ok) {
  el.textContent = text;
  el.className = "alert " + (ok ? "ok" : "err");
  el.hidden = false;
}

function handleAuthError(err) {
  if (err.status === 401) {
    showLogin();
    showMsg($("loginMsg"), "Your session expired. Please sign in again.", false);
    return true;
  }
  return false;
}

// ---------- Views ----------
function showLogin() {
  $("adminView").hidden = true;
  $("loginView").hidden = false;
  $("password").focus();
}

function showDashboard() {
  $("loginView").hidden = true;
  $("adminView").hidden = false;
  loadFaqs();
}

// ---------- Auth ----------
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginMsg").hidden = true;
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    $("password").value = "";
    showDashboard();
  } catch (err) {
    showMsg($("loginMsg"), err.message, false);
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

// ---------- Load and list ----------
async function loadFaqs() {
  try {
    faqs = await api("/api/faqs");
    const cats = [...new Set(faqs.map((f) => f.category))];
    $("categoryList").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
    renderTable();
  } catch (err) {
    $("manageBody").innerHTML = `<tr><td colspan="4">${esc(err.message)}</td></tr>`;
  }
}

function renderTable() {
  const q = $("manageSearch").value.toLowerCase().trim();
  const rows = faqs.filter((f) => !q || (f.code + " " + f.category + " " + f.question + " " + f.answer).toLowerCase().includes(q));
  $("manageCount").textContent = "(" + rows.length + ")";
  $("manageBody").innerHTML = rows.length
    ? rows.map((f) => `
      <tr>
        <td class="code">${esc(f.code)}</td>
        <td>${esc(f.category)}</td>
        <td>${esc(f.question)}</td>
        <td><button class="btn ghost small" data-edit="${esc(f.id)}">Edit</button></td>
      </tr>`).join("")
    : `<tr><td colspan="4">No FAQs match.</td></tr>`;
  $("manageBody").querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEdit(b.dataset.edit)));
}

$("manageSearch").addEventListener("input", renderTable);

// ---------- Add ----------
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    category: $("addCategory").value.trim(),
    question: $("addQuestion").value.trim(),
    answer: $("addAnswer").value.trim(),
  };
  if (!body.question || !body.answer) {
    showMsg($("addMsg"), "Question and answer cannot be empty.", false);
    return;
  }
  $("addBtn").disabled = true;
  try {
    const r = await api("/api/admin/faqs", { method: "POST", body: JSON.stringify(body) });
    showMsg($("addMsg"), "Saved as " + r.code + ". It is now visible on the FAQ page.", true);
    $("addQuestion").value = "";
    $("addAnswer").value = "";
    loadFaqs();
  } catch (err) {
    if (!handleAuthError(err)) showMsg($("addMsg"), err.message, false);
  } finally {
    $("addBtn").disabled = false;
  }
});

// ---------- Edit ----------
let editingId = null;

function openEdit(id) {
  const f = faqs.find((x) => x.id === id);
  if (!f) return;
  editingId = id;
  $("editCode").textContent = f.code;
  $("editCategory").value = f.category;
  $("editQuestion").value = f.question;
  $("editAnswer").value = f.answer;
  $("editMsg").hidden = true;
  $("editDialog").showModal();
}

$("editCancel").addEventListener("click", () => $("editDialog").close());

$("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    category: $("editCategory").value.trim(),
    question: $("editQuestion").value.trim(),
    answer: $("editAnswer").value.trim(),
  };
  if (!body.question || !body.answer) {
    showMsg($("editMsg"), "Question and answer cannot be empty.", false);
    return;
  }
  $("editSave").disabled = true;
  try {
    await api("/api/admin/faqs/" + encodeURIComponent(editingId), { method: "PATCH", body: JSON.stringify(body) });
    $("editDialog").close();
    loadFaqs();
  } catch (err) {
    if (handleAuthError(err)) $("editDialog").close();
    else showMsg($("editMsg"), err.message, false);
  } finally {
    $("editSave").disabled = false;
  }
});

// ---------- Excel upload ----------
// The file is parsed in the browser with SheetJS; only clean JSON rows are sent to the server.
function pick(row, names) {
  for (const key of Object.keys(row)) {
    if (names.includes(key.trim().toLowerCase())) return row[key];
  }
  return "";
}

$("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  pendingRows = [];
  $("uploadBtn").disabled = true;
  $("uploadMsg").hidden = true;
  $("uploadDetails").innerHTML = "";
  if (!file) {
    $("filePreview").textContent = "No file selected";
    return;
  }
  try {
    if (typeof XLSX === "undefined") throw new Error("Excel reader failed to load. Check your internet connection.");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets["FAQ"] || wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    pendingRows = json.map((r) => ({
      code: String(pick(r, ["faq_id", "faq id", "code", "faq_code"])).trim(),
      category: String(pick(r, ["category"])).trim(),
      question: String(pick(r, ["question"])).trim(),
      answer: String(pick(r, ["answer"])).trim(),
    }));
    if (!pendingRows.length) throw new Error("The sheet has no data rows.");
    $("filePreview").textContent = file.name + ": " + pendingRows.length + " rows found";
    $("uploadBtn").disabled = false;
  } catch (err) {
    $("filePreview").textContent = file.name;
    showMsg($("uploadMsg"), err.message, false);
  }
});

$("uploadBtn").addEventListener("click", async () => {
  if (!pendingRows.length) return;
  $("uploadBtn").disabled = true;
  showMsg($("uploadMsg"), "Uploading " + pendingRows.length + " rows...", true);
  try {
    const r = await api("/api/admin/faqs/bulk", { method: "POST", body: JSON.stringify({ rows: pendingRows }) });
    showMsg(
      $("uploadMsg"),
      `Done. Inserted ${r.inserted}, updated ${r.updated}, skipped ${r.skipped}, failed ${r.failed}.`,
      r.failed === 0
    );
    $("uploadDetails").innerHTML = r.details
      .filter((d) => d.result === "skipped" || d.result === "failed")
      .map((d) => `<li>Row ${d.row} (${esc(d.code)}): ${esc(d.result)}. ${esc(d.message || "")}</li>`)
      .join("");
    loadFaqs();
  } catch (err) {
    if (!handleAuthError(err)) showMsg($("uploadMsg"), err.message, false);
  } finally {
    $("uploadBtn").disabled = false;
  }
});

// ---------- Start ----------
api("/api/admin/session")
  .then((s) => (s.authenticated ? showDashboard() : showLogin()))
  .catch(() => showLogin());
