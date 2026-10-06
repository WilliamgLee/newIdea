// Panel admin AI Office. Semua keamanan ada di server; ini hanya UI.
// CSRF: token dari cookie non-HttpOnly, dikirim balik di header X-CSRF-Token (double-submit).
"use strict";

const GATE_SCRIPT = "awaiting_script_approval";
const GATE_FINAL = "awaiting_final_approval";

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
    msg.textContent = `Job #${job.id} dibuat`;
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
    tr.append(el("td", String(j.id)), el("td", j.title || j.topic), el("td", j.status));
    const actions = el("td");
    if (j.status === GATE_SCRIPT) {
      actions.append(btn("Approve naskah", () => act(j.id, "approve-script")));
      actions.append(btn("Tolak", () => act(j.id, "reject")));
    } else if (j.status === GATE_FINAL) {
      actions.append(btn("Approve final", () => act(j.id, "approve-final")));
      actions.append(btn("Tolak", () => act(j.id, "reject")));
    } else if (j.status === "failed") {
      actions.append(btn("Retry", () => act(j.id, "retry")));
    }
    actions.append(btn("Detail", () => showDetail(j.id)));
    tr.append(actions);
    tbody.append(tr);
  });
}

function btn(label, onClick) {
  const b = el("button", label);
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
  d.append(el("h3", `Job #${job.id}: ${job.title || job.topic}`));
  if (job.error) d.append(el("p", `Error: ${job.error}`, "error"));

  (job.safety_reviews || []).forEach((r) => {
    d.append(el("h4", `Review keamanan putaran ${r.round}: ${r.verdict.toUpperCase()}`));
    const ul = el("ul");
    (r.review.items || []).forEach((it) => {
      ul.append(el("li", `${it.ok ? "OK" : "XX"} ${it.criterion}: ${it.reason}`));
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
