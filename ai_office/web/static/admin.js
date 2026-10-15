// Panel admin AI Office. Semua keamanan ada di server; ini hanya UI.
// CSRF: token dari cookie non-HttpOnly, dikirim balik di header X-CSRF-Token (double-submit).
"use strict";

const GATE_SCRIPT = "awaiting_script_approval";
const GATE_FINAL = "awaiting_final_approval";
const STATUS_KIND = { done: "ok", failed: "bad", rejected: "bad", [GATE_SCRIPT]: "warn", [GATE_FINAL]: "warn" };

function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)ai_office_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function api(path, { method = "GET", body } = {}) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (method !== "GET") opts.headers["X-CSRF-Token"] = csrfToken();
  const res = await fetch(path, opts);
  if (res.status === 401) {
    showLogin();
    throw new Error("Perlu login");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : {};
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
  return data;
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function show(id, visible) {
  document.getElementById(id).hidden = !visible;
}

function showLogin() {
  show("login-view", true);
  show("admin-view", false);
}

// ---------------------------------------------------------------- login
async function init() {
  const status = await api("/api/auth/status");
  if (status.authenticated) {
    enterAdmin();
  } else {
    showLogin();
    show("no-admin", !status.admin_configured);
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("login-error");
  err.textContent = "";
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: {
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
      },
    });
    document.getElementById("password").value = "";
    enterAdmin();
  } catch (ex) {
    err.textContent = ex.message;
  }
});

document.getElementById("logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showLogin();
});

// ---------------------------------------------------------------- panel
async function enterAdmin() {
  show("login-view", false);
  show("admin-view", true);
  const settings = await api("/api/admin/settings");
  document.getElementById("mode").value = settings.mode;
  await refreshJobs();
  connectEvents();
}

document.getElementById("mode").addEventListener("change", async (e) => {
  await api("/api/admin/mode", { method: "POST", body: { mode: e.target.value } });
});

document.getElementById("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("create-msg");
  try {
    const job = await api("/api/admin/jobs", {
      method: "POST",
      body: {
        topic: document.getElementById("topic").value,
        age_group: document.getElementById("age").value,
        style: document.getElementById("style").value,
      },
    });
    msg.textContent = `Job #${job.id} dibuat. Lihat agentnya bekerja di halaman Kantor.`;
    document.getElementById("topic").value = "";
    await refreshJobs();
  } catch (ex) {
    msg.textContent = ex.message;
  }
});

async function refreshJobs() {
  let jobs;
  try {
    jobs = await api("/api/admin/jobs?limit=50");
  } catch {
    return;
  }
  const tbody = document.getElementById("jobs");
  tbody.replaceChildren();
  jobs.forEach((j) => {
    const tr = el("tr");
    const status = el("td");
    status.append(el("span", j.status, `tag tag-${STATUS_KIND[j.status] || "info"}`));
    tr.append(el("td", `#${j.id}`, "mono"), el("td", j.title || j.topic), status);
    const actions = el("td");
    if (j.status === GATE_SCRIPT) {
      actions.append(btn("Approve naskah", () => act(j.id, "approve-script"), "btn-green", "handoff"));
      actions.append(btn("Tolak", () => act(j.id, "reject"), "btn-red", "reject"));
    } else if (j.status === GATE_FINAL) {
      actions.append(btn("Approve final", () => act(j.id, "approve-final"), "btn-green", "handoff"));
      actions.append(btn("Tolak", () => act(j.id, "reject"), "btn-red", "reject"));
    } else if (j.status === "failed") {
      actions.append(btn("Retry", () => act(j.id, "retry"), "btn-yellow"));
    }
    actions.append(btn("Detail", () => showDetail(j.id), "btn-tan"));
    tr.append(actions);
    tbody.append(tr);
  });
}

// Tombol pixel. Bunyi kliknya diputar otomatis oleh sfx.js (data-sfx memilih bunyi lain).
function btn(label, onClick, variant = "", sound = "") {
  const b = el("button", label, `btn-sm ${variant}`.trim());
  b.type = "button";
  if (sound) b.dataset.sfx = sound;
  b.addEventListener("click", onClick);
  return b;
}

async function act(id, action) {
  try {
    await api(`/api/admin/jobs/${id}/${action}`, { method: "POST", body: {} });
    await refreshJobs();
  } catch (ex) {
    alert(ex.message);
  }
}

async function showDetail(id) {
  const d = document.getElementById("detail");
  const job = await api(`/api/admin/jobs/${id}`);
  d.replaceChildren();
  d.hidden = false;
  const head = el("div", undefined, "panel-head");
  head.append(el("h3", `Job #${job.id}: ${job.title || job.topic}`));
  head.append(btn("Tutup", () => (d.hidden = true)));
  d.append(head);
  if (job.error) d.append(el("p", `Error: ${job.error}`, "error"));

  // pemutar video hasil Editor (file dilayani endpoint admin, butuh login)
  const editor = job.artifacts && job.artifacts.editor;
  if (editor && editor.video_file) {
    d.append(el("h4", "Video"));
    const video = el("video", undefined, "job-video");
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    if (editor.thumbnail_file) video.poster = `/api/admin/jobs/${job.id}/thumbnail`;
    video.src = `/api/admin/jobs/${job.id}/video`;
    const meta = el("p", [
      editor.duration_sec != null ? `${editor.duration_sec} detik` : null,
      editor.bgm ? `musik: ${editor.bgm}` : "tanpa musik",
      editor.encoder ? `encoder: ${editor.encoder}` : null,
    ].filter(Boolean).join(" · "), "muted small");
    d.append(video, meta);
  }

  (job.safety_reviews || []).forEach((r) => {
    d.append(el("h4", `Review keamanan putaran ${r.round}: ${r.verdict.toUpperCase()}`));
    const ul = el("ul", undefined, "review-list");
    (r.review.items || []).forEach((it) => {
      const li = el("li");
      li.append(el("span", it.ok ? "OK" : "X", `tag tag-${it.ok ? "ok" : "bad"}`),
        el("span", `${it.criterion}: ${it.reason}`));
      ul.append(li);
    });
    d.append(ul);
  });

  const script = (job.artifacts && job.artifacts.writer && job.artifacts.writer.script) || null;
  if (script) {
    d.append(el("h4", "Naskah"));
    const pre = el("pre");
    pre.textContent = JSON.stringify(script, null, 2);
    d.append(pre);
  }
}

function connectEvents() {
  const es = new EventSource("/api/events");
  ["job_status", "job_created", "agent_state"].forEach((t) =>
    es.addEventListener(t, refreshJobs),
  );
}

init();
