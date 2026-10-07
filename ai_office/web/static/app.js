// Dashboard publik: kantor 2.5D (office.js) + ringkasan + daftar video, real-time via SSE.
"use strict";

import { Office } from "/static/office.js";

const office = new Office(document.getElementById("office"));
office.start();

function el(tag, text) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text; // textContent: aman dari XSS
  return e;
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
    tr.append(
      el("td", String(j.id)),
      el("td", j.title || j.topic),
      el("td", j.status),
      el("td", j.duration_sec != null ? `${j.duration_sec}s` : "-"),
    );
    tbody.append(tr);
  });
}

async function refreshStatus() {
  const res = await fetch("/api/status");
  if (!res.ok) return;
  const data = await res.json();
  office.setStates(data.agents);
  renderSummary(data.summary);
}

function connect() {
  const conn = document.getElementById("conn");
  const es = new EventSource("/api/events");
  es.onopen = () => (conn.textContent = "terhubung (real-time)");
  es.onerror = () => (conn.textContent = "koneksi terputus, mencoba lagi…");

  es.addEventListener("snapshot", (e) => {
    const { data } = JSON.parse(e.data);
    office.setStates(data.agents);
    renderSummary(data.summary);
    refreshJobs();
  });
  es.addEventListener("agent_state", (e) => {
    const { data } = JSON.parse(e.data);
    office.setStates([data]);
  });
  ["job_status", "job_created"].forEach((type) =>
    es.addEventListener(type, () => {
      refreshJobs();
      refreshStatus();
    }),
  );
}

setInterval(refreshStatus, 5000);
refreshStatus();
refreshJobs();
connect();
