// CIT Student FAQ Portal - backend
// Express server that talks to Salesforce (Student_FAQ__c) through the REST API.
// The browser never sees Salesforce credentials: every Salesforce call happens here.

require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");

// ---------- Configuration (from .env locally, from Render "Environment" in production) ----------
const {
  SF_INSTANCE_URL,
  SF_CLIENT_ID,
  SF_CLIENT_SECRET,
  ADMIN_PASSWORD,
  SESSION_SECRET,
} = process.env;
const SF_API_VERSION = process.env.SF_API_VERSION || "v62.0";
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const OBJECT = "Student_FAQ__c";

const missing = ["SF_INSTANCE_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET", "ADMIN_PASSWORD", "SESSION_SECRET"]
  .filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing environment variables: " + missing.join(", "));
  console.error("Copy .env.example to .env and fill in the values.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// ---------- Salesforce helpers ----------
class SalesforceError extends Error {
  constructor(status, details) {
    super("Salesforce request failed with HTTP " + status);
    this.status = status;
    this.details = details;
  }
}

let tokenCache = { token: null, expiresAt: 0 };

// OAuth 2.0 Client Credentials flow: the server logs in as the "Run As" user of the External Client App.
async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const res = await fetch(SF_INSTANCE_URL + "/services/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: SF_CLIENT_ID,
      client_secret: SF_CLIENT_SECRET,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new SalesforceError(res.status, data);
  }
  // Reuse the token for 50 minutes, then fetch a new one.
  tokenCache = { token: data.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return tokenCache.token;
}

// Generic REST call. "urlPath" starts with /services/data/...
async function sfFetch(method, urlPath, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(attempt > 0);
    const res = await fetch(SF_INSTANCE_URL + urlPath, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) continue; // token expired, refresh once and retry
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new SalesforceError(res.status, data);
    return { status: res.status, data };
  }
}

const apiPath = (p) => "/services/data/" + SF_API_VERSION + p;

// Runs a SOQL query and follows pagination so all rows are returned.
async function query(soql) {
  let result = await sfFetch("GET", apiPath("/query?q=" + encodeURIComponent(soql)));
  const records = [...result.data.records];
  while (result.data.nextRecordsUrl) {
    result = await sfFetch("GET", result.data.nextRecordsUrl);
    records.push(...result.data.records);
  }
  return records;
}

// Upsert on the External ID field FAQ_Code__c: 201 = inserted, 204 = updated.
async function upsertByCode(code, fields) {
  const r = await sfFetch(
    "PATCH",
    apiPath("/sobjects/" + OBJECT + "/FAQ_Code__c/" + encodeURIComponent(code)),
    fields
  );
  return r.status === 201 ? "inserted" : "updated";
}

const soqlString = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

function toFaq(r) {
  return {
    id: r.Id,
    code: r.FAQ_Code__c,
    question: r.Question__c || "",
    answer: r.Answer__c || "",
    category: r.Category__c || "General",
    updatedAt: r.LastModifiedDate,
  };
}

// ---------- Validation ----------
const LIMITS = { question: 1000, answer: 5000, category: 50 };
const CODE_RE = /^[A-Za-z0-9_-]{1,50}$/;
const ID_RE = /^[A-Za-z0-9]{15,18}$/;

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function validateFaqInput(body) {
  const question = clean(body.question, LIMITS.question);
  const answer = clean(body.answer, LIMITS.answer);
  const category = clean(body.category, LIMITS.category) || "General";
  const errors = [];
  if (!question) errors.push("Question is required.");
  if (!answer) errors.push("Answer is required.");
  return { errors, fields: { Question__c: question, Answer__c: answer, Category__c: category } };
}

async function nextFaqCode() {
  const rows = await query("SELECT FAQ_Code__c FROM " + OBJECT + " WHERE FAQ_Code__c LIKE 'CIT%'");
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.FAQ_Code__c).replace(/^CIT/i, ""), 10);
    if (!isNaN(n) && n < 900 && n > max) max = n; // 9xx codes are reserved for test rows
  }
  return "CIT" + String(max + 1).padStart(3, "0");
}

// ---------- Admin session (signed, httpOnly cookie) ----------
const COOKIE = "cit_admin";
const SESSION_HOURS = 8;

const sign = (v) => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("hex");

function createSessionToken() {
  const payload = "admin." + (Date.now() + SESSION_HOURS * 3600 * 1000);
  return payload + "." + sign(payload);
}

function isValidSession(token) {
  if (!token) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const expiry = Number(payload.split(".")[1]);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function setSessionCookie(res, value, maxAgeSeconds) {
  const parts = [
    COOKIE + "=" + encodeURIComponent(value),
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + maxAgeSeconds,
  ];
  if (IS_PROD) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

// Server-side authorization check for every admin API route.
function requireAdmin(req, res, next) {
  if (isValidSession(readCookie(req, COOKIE))) return next();
  res.status(401).json({ error: "Admin login required." });
}

function passwordMatches(input) {
  const a = crypto.createHash("sha256").update(String(input || "")).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Basic brute-force protection: 10 failed logins per IP per 15 minutes.
const failedLogins = new Map();
function tooManyAttempts(ip) {
  const entry = failedLogins.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > 15 * 60 * 1000) {
    failedLogins.delete(ip);
    return false;
  }
  return entry.count >= 10;
}
function recordFailure(ip) {
  const entry = failedLogins.get(ip) || { count: 0, first: Date.now() };
  entry.count++;
  failedLogins.set(ip, entry);
}

// ---------- Public API (read only) ----------
app.get("/api/faqs", async (req, res, next) => {
  try {
    const rows = await query(
      "SELECT Id, FAQ_Code__c, Question__c, Answer__c, Category__c, LastModifiedDate FROM " +
        OBJECT + " ORDER BY FAQ_Code__c ASC"
    );
    res.set("Cache-Control", "no-store");
    res.json(rows.map(toFaq));
  } catch (err) {
    next(err);
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------- Admin API ----------
app.post("/api/admin/login", (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  }
  if (!passwordMatches(req.body && req.body.password)) {
    recordFailure(ip);
    return res.status(401).json({ error: "Incorrect password." });
  }
  failedLogins.delete(ip);
  setSessionCookie(res, createSessionToken(), SESSION_HOURS * 3600);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  setSessionCookie(res, "", 0);
  res.json({ ok: true });
});

app.get("/api/admin/session", (req, res) => {
  res.json({ authenticated: isValidSession(readCookie(req, COOKIE)) });
});

// Add a new FAQ. The code is generated (CIT026, CIT027...) unless one is given.
app.post("/api/admin/faqs", requireAdmin, async (req, res, next) => {
  try {
    const { errors, fields } = validateFaqInput(req.body || {});
    let code = clean(req.body && req.body.code, 50);
    if (code && !CODE_RE.test(code)) errors.push("FAQ code may only contain letters, numbers, - and _.");
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });

    if (code) {
      const existing = await query("SELECT Id FROM " + OBJECT + " WHERE FAQ_Code__c = " + soqlString(code));
      if (existing.length) return res.status(409).json({ error: "FAQ code " + code + " already exists. Use Edit instead." });
    } else {
      code = await nextFaqCode();
    }
    await upsertByCode(code, fields);
    res.status(201).json({ ok: true, code });
  } catch (err) {
    next(err);
  }
});

// Edit an existing FAQ by its Salesforce record Id.
app.patch("/api/admin/faqs/:id", requireAdmin, async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: "Invalid record id." });
    const { errors, fields } = validateFaqInput(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });
    await sfFetch("PATCH", apiPath("/sobjects/" + OBJECT + "/" + req.params.id), fields);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Bulk upload from an Excel file (parsed in the browser). Same upsert logic as the UiPath robot.
app.post("/api/admin/faqs/bulk", requireAdmin, async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) return res.status(400).json({ error: "No rows received." });
    if (rows.length > 300) return res.status(400).json({ error: "Upload at most 300 rows at a time." });

    const summary = { inserted: 0, updated: 0, skipped: 0, failed: 0, details: [] };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNo = i + 2; // +2 because row 1 in Excel is the header
      const code = clean(row.code, 50);
      const { errors, fields } = validateFaqInput(row);
      if (!code || !CODE_RE.test(code)) errors.unshift("Missing or invalid FAQ_ID.");
      if (errors.length) {
        summary.skipped++;
        summary.details.push({ row: rowNo, code: code || "(blank)", result: "skipped", message: errors.join(" ") });
        continue;
      }
      try {
        const result = await upsertByCode(code, fields);
        summary[result]++;
        summary.details.push({ row: rowNo, code, result });
      } catch (e) {
        summary.failed++;
        summary.details.push({ row: rowNo, code, result: "failed", message: "Salesforce rejected this row." });
        console.error("Bulk row failed", code, e.details || e.message);
      }
    }
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// ---------- Pages ----------
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  if (err instanceof SalesforceError) {
    console.error("Salesforce error:", err.status, JSON.stringify(err.details));
    return res.status(502).json({ error: "Could not reach the FAQ database (Salesforce). Please try again." });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log("CIT FAQ Portal running on http://localhost:" + PORT);
});
