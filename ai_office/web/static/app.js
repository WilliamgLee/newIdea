// M0: dashboard status sederhana (hanya-baca) via SSE.
"use strict";

const STATE_LABEL = {
  working: "sedang kerja",
  just_done: "baru selesai",
  idle: "santai",
  offline: "offline",
};

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text; // textContent: aman dari XSS
  if (cls) e.className = cls;
  return e;
}

const agents = {};

function renderAgents() {
  const ul = document.getElementById("agents");
  ul.replaceChildren();
  Object.values(agents).forEach((a) => {
    const li = el("li");
    li.append(el("span", STATE_LABEL[a.state] || a.state, `state state-${a.state}`), " ", a.label);
    ul.append(li);
  });
}

function renderSummary(s) {
  const ul = document.getElementById("summary");
  ul.replaceChildren(
    el("li", `Mode: ${s.mode}`),
    el("li", `Job aktif: ${s.active_jobs}`),
    el("li", `Antrean: ${s.queued_jobs}`),
    el("li", `Menunggu persetujuan: ${s.awaiting_approval}`),
    el("li", `Video selesai: ${s.done_jobs}`),
    el("li", `Waktu proses terakhir: ${s.last_process_sec ?? "-"} detik`),
  );
}

async function refreshJobs() {
  const res = await fetch("/api/jobs?limit=20");
  if (!res.ok) return;
  const tbody = document.getElementById("jobs");
  tbody.replaceChildren();
  (await res.json()).forEach((j) => {
    const tr = el("tr");
    tr.append(el("td", String(j.id)), el("td", j.title || j.topic), el("td", j.status));
    tbody.append(tr);
  });
}

async function refreshStatus() {
  const res = await fetch("/api/status");
  if (!res.ok) return;
  const data = await res.json();
  data.agents.forEach((a) => (agents[a.agent] = a));
  renderAgents();
  renderSummary(data.summary);
}

function connect() {
  const conn = document.getElementById("conn");
  const es = new EventSource("/api/events");
  es.onopen = () => (conn.textContent = "terhubung (real-time)");
  es.onerror = () => (conn.textContent = "koneksi terputus, mencoba lagi…");

  es.addEventListener("snapshot", (e) => {
    const { data } = JSON.parse(e.data);
    data.agents.forEach((a) => (agents[a.agent] = a));
    renderAgents();
    renderSummary(data.summary);
    refreshJobs();
  });
  es.addEventListener("agent_state", (e) => {
    const { data } = JSON.parse(e.data);
    agents[data.agent] = data;
    renderAgents();
  });
  ["job_status", "job_created"].forEach((type) =>
    es.addEventListener(type, () => {
      refreshJobs();
      refreshStatus();
    }),
  );
}

// status "baru selesai" berubah jadi "santai" setelah beberapa detik
setInterval(refreshStatus, 5000);
connect();
