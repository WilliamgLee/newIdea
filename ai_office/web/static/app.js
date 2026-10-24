// Dashboard publik: kantor pixel 2.5D (office.js) + status, daftar agent, log kantor, dan daftar
// video. Real-time via SSE. Tambahkan ?demo di URL untuk simulasi satu job tanpa server.
"use strict";

import { AGENTS, Office } from "/static/office.js";
import { sfx } from "/static/sfx.js";

const PIPELINE = ["writer", "safety", "voice", "animator", "editor", "delivery"];
const STATE_LABEL = { working: "KERJA", just_done: "SELESAI", idle: "SANTAI", offline: "OFFLINE" };
const STATUS_LABEL = {
  scheduled: "terjadwal", queued: "antre", writing: "menulis", safety_review: "cek keamanan",
  awaiting_script_approval: "tunggu admin", voicing: "rekam suara", animating: "animasi",
  editing: "editing", awaiting_final_approval: "tunggu admin", delivering: "kirim",
  uploading: "unggah", done: "selesai", failed: "gagal", rejected: "ditolak",
};
const STATUS_KIND = { done: "ok", failed: "bad", rejected: "bad", awaiting_script_approval: "warn",
  awaiting_final_approval: "warn" };

const agentStates = {};
const VIEW_KEY = "kiki.officeView";
const HINT = {
  "2d": "Klik ruangan untuk lihat agentnya, klik kucingnya juga.",
  "3d": "Seret: putar. Klik kanan/Shift+seret: geser. Scroll: zoom. Klik ruangan: lihat agent; kucing & pejalan kaki juga bisa diklik.",
};
const views = {};
let office = null; // tampilan yang sedang aktif (Office 2D atau Office3D, API-nya sama)

// Modul 3D (Three.js) baru dimuat saat pertama kali tombol 3D dipakai.
async function makeView(kind) {
  if (!views[kind]) {
    if (kind === "3d") {
      const { Office3D } = await import("/static/office3d.js");
      views[kind] = new Office3D(document.getElementById("office3d"), { onSelect: showAgent, onExplore: showExplore });
    } else {
      views[kind] = new Office(document.getElementById("office"), { onSelect: showAgent });
    }
  }
  return views[kind];
}

async function useView(kind) {
  let next;
  try {
    next = await makeView(kind);
  } catch (err) {
    if (kind !== "3d") throw err;
    console.error(err);
    useView("2d");
    setMessage("3D", "bad", "Tampilan 3D tidak bisa dibuka di browser ini (WebGL mati?). Kembali ke 2D.");
    return;
  }
  if (office && office !== next) office.stop();
  office = next;
  document.getElementById("office").hidden = kind !== "2d";
  document.getElementById("office3d").hidden = kind !== "3d";
  document.getElementById("view-2d").setAttribute("aria-pressed", String(kind === "2d"));
  document.getElementById("view-3d").setAttribute("aria-pressed", String(kind === "3d"));
  document.getElementById("view-reset").hidden = kind !== "3d";
  document.getElementById("view-explore").hidden = kind !== "3d";
  document.getElementById("office-hint").textContent = HINT[kind];
  office.setStates(Object.values(agentStates));
  office.start();
  try {
    localStorage.setItem(VIEW_KEY, kind);
  } catch { /* penyimpanan diblokir: pilihan cukup berlaku sampai halaman ditutup */ }
}

function savedView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "3d" ? "3d" : "2d";
  } catch {
    return "2d";
  }
}

document.getElementById("view-2d").addEventListener("click", () => useView("2d"));
document.getElementById("view-3d").addEventListener("click", () => useView("3d"));
document.getElementById("view-reset").addEventListener("click", () => office.resetView?.());
document.getElementById("view-explore").addEventListener("click", () => office.setExplore?.(!office.explore));

function showExplore(on) {
  const btn = document.getElementById("view-explore");
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "KELUAR JELAJAH" : "JELAJAH";
  document.getElementById("office-hint").textContent = on
    ? "Mode jelajah: klik kantor untuk mulai, Esc untuk melepas mouse." : HINT["3d"];
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text; // textContent: aman dari XSS
  if (cls) e.className = cls;
  return e;
}

// ------------------------------------------------------------------ pesan & log
function setMessage(tag, kind, text) {
  const t = document.getElementById("msg-tag");
  t.textContent = tag;
  t.className = `tag tag-${kind}`;
  document.getElementById("msg").textContent = text;
}

function addFeed(entry) {
  const feed = document.getElementById("feed");
  if (feed.firstElementChild?.classList.contains("muted")) feed.replaceChildren();
  const li = el("li");
  const time = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  li.append(el("span", time, "feed-time"), el("span", entry.tag, `tag tag-${entry.kind}`),
    el("span", entry.text, "feed-text"));
  feed.prepend(li);
  while (feed.children.length > 30) feed.lastElementChild.remove();
  setMessage(entry.tag, entry.kind, entry.text);
}

function showAgent(id) {
  const def = AGENTS[id];
  const st = agentStates[id];
  const state = id === "admin" ? "" : ` Status: ${STATE_LABEL[st?.state] || "OFFLINE"}`
    + (st?.job_id ? ` (job #${st.job_id}).` : ".");
  setMessage(def.label, "info", `${def.name}: ${def.role}${state}`);
  document.querySelectorAll("#agent-list li").forEach((li) => {
    li.classList.toggle("active", li.dataset.agent === id);
  });
}

// ------------------------------------------------------------------ panel samping
function renderAgents() {
  const ul = document.getElementById("agent-list");
  const active = ul.querySelector("li.active")?.dataset.agent;
  ul.replaceChildren();
  PIPELINE.forEach((id) => {
    const def = AGENTS[id];
    const st = agentStates[id]?.state || "offline";
    const li = el("li");
    li.dataset.agent = id;
    if (id === active) li.classList.add("active");
    const btn = el("button", undefined, "agent-btn");
    btn.type = "button";
    btn.dataset.sfx = "none"; // bunyi "select" diputar oleh office.select
    const swatch = el("span", undefined, "swatch");
    swatch.style.background = def.shirt;
    btn.append(swatch, el("span", def.name, "agent-name"),
      el("span", STATE_LABEL[st] || st, `tag tag-state-${st}`));
    btn.addEventListener("click", () => office.select(id));
    li.append(btn);
    ul.append(li);
  });
}

function renderSummary(s) {
  const box = document.getElementById("summary");
  const stat = (label, value, cls = "") => {
    const d = el("div", undefined, `stat ${cls}`);
    d.append(el("span", String(value ?? "-"), "stat-value"), el("span", label, "stat-label"));
    return d;
  };
  box.replaceChildren(
    stat("aktif", s.active_jobs, s.active_jobs ? "stat-hot" : ""),
    stat("antre", s.queued_jobs),
    stat("tunggu admin", s.awaiting_approval, s.awaiting_approval ? "stat-warn" : ""),
    stat("selesai", s.done_jobs, "stat-ok"),
    stat("mode", s.mode === "full_auto" ? "AUTO" : "SEMI"),
    stat("proses terakhir", s.last_process_sec != null ? `${s.last_process_sec}s` : "-"),
  );
}

function renderJobs(jobs) {
  const tbody = document.getElementById("jobs");
  tbody.replaceChildren();
  if (!jobs.length) {
    const tr = el("tr");
    const td = el("td", "Belum ada video.", "muted");
    td.colSpan = 4;
    tr.append(td);
    tbody.append(tr);
    return;
  }
  jobs.forEach((j) => {
    const tr = el("tr");
    const status = el("td");
    status.append(el("span", STATUS_LABEL[j.status] || j.status, `tag tag-${STATUS_KIND[j.status] || "info"}`));
    tr.append(
      el("td", `#${j.id}`, "mono"),
      el("td", j.title || j.topic),
      status,
      el("td", j.duration_sec != null ? `${j.duration_sec}s` : "-", "mono"),
    );
    tbody.append(tr);
  });
}

function applyAgents(list) {
  list.forEach((a) => (agentStates[a.agent] = a));
  office.setStates(list);
  renderAgents();
}

// ------------------------------------------------------------------ data server
async function refreshJobs() {
  const res = await fetch("/api/jobs?limit=20");
  if (res.ok) renderJobs(await res.json());
}

async function refreshStatus() {
  const res = await fetch("/api/status");
  if (!res.ok) return;
  const data = await res.json();
  applyAgents(data.agents);
  renderSummary(data.summary);
}

function setConn(text, ok) {
  const conn = document.getElementById("conn");
  conn.textContent = text;
  conn.classList.toggle("pill-ok", ok);
  conn.classList.toggle("pill-bad", !ok);
}

function connect() {
  const es = new EventSource("/api/events");
  es.onopen = () => setConn("LIVE", true);
  es.onerror = () => setConn("TERPUTUS", false);

  es.addEventListener("snapshot", (e) => {
    const { data } = JSON.parse(e.data);
    applyAgents(data.agents);
    renderSummary(data.summary);
    refreshJobs();
  });
  es.addEventListener("agent_state", (e) => {
    const { data } = JSON.parse(e.data);
    applyAgents([data]);
  });
  ["job_status", "job_created"].forEach((type) =>
    es.addEventListener(type, (e) => {
      const { data } = JSON.parse(e.data);
      const entry = office.jobEvent(type, data);
      if (entry) addFeed(entry);
      refreshJobs();
      refreshStatus();
    }),
  );
  es.addEventListener("mode_changed", (e) => {
    const { data } = JSON.parse(e.data);
    addFeed({ tag: "MODE", kind: "info", text: `Mode diganti ke ${data.mode}` });
    refreshStatus();
  });
}

// ------------------------------------------------------------------ mode demo (?demo)
function runDemo() {
  setConn("DEMO", true);
  let id = 100;
  const jobs = [];
  const summary = { active_jobs: 0, queued_jobs: 0, awaiting_approval: 0, done_jobs: 0,
    mode: "semi_auto", last_process_sec: null };
  const setAgent = (agent, state) => applyAgents([{ agent, state, job_id: state === "working" ? id : null }]);
  PIPELINE.forEach((a) => setAgent(a, "idle"));
  renderSummary(summary);
  renderJobs(jobs);

  const emit = (type, job) => {
    const entry = office.jobEvent(type, job);
    if (entry) addFeed(entry);
    renderJobs(jobs);
    renderSummary(summary);
  };

  function oneJob(fail) {
    id += 1;
    const job = { id, topic: fail ? "animal sounds" : "learn colors", title: null, status: "queued",
      duration_sec: null };
    jobs.unshift(job);
    const steps = [
      [0, () => { summary.active_jobs = 1; emit("job_created", job); }],
      [1.5, () => move("writing", "writer")],
      [7, () => move("safety_review", "safety", "writer")],
      [12, () => move("writing", "writer", "safety")],
      [18, () => move("safety_review", "safety", "writer")],
      [23, () => { summary.awaiting_approval = 1; move("awaiting_script_approval", null, "safety"); }],
      [30, () => { summary.awaiting_approval = 0; move("voicing", "voice"); }],
      [37, () => (fail ? failAt("animator") : move("animating", "animator", "voice"))],
      ...(fail ? [] : [
        [44, () => move("editing", "editor", "animator")],
        [51, () => { summary.awaiting_approval = 1; move("awaiting_final_approval", null, "editor"); }],
        [58, () => { summary.awaiting_approval = 0; move("delivering", "delivery"); }],
        [64, () => {
          job.title = "Let's Learn Colors!";
          job.duration_sec = 31.4;
          summary.done_jobs += 1;
          summary.active_jobs = 0;
          summary.last_process_sec = 212;
          move("done", null, "delivery");
        }],
      ]),
    ];
    function move(status, worker, finished) {
      const previous = job.status;
      job.status = status;
      if (finished) {
        setAgent(finished, "just_done");
        setTimeout(() => setAgent(finished, "idle"), 6000);
      }
      if (worker) setAgent(worker, "working");
      emit("job_status", { ...job, previous });
    }
    function failAt(agent) {
      move("animating", agent, "voice");
      setTimeout(() => {
        const previous = job.status;
        job.status = "failed";
        summary.active_jobs = 0;
        setAgent(agent, "idle");
        emit("job_status", { ...job, previous });
      }, 4000);
    }
    steps.forEach(([t, fn]) => setTimeout(fn, t * 1000));
    return fail ? 46 : 72;
  }

  let round = 0;
  const loop = () => {
    const dur = oneJob(round % 2 === 1);
    round += 1;
    setTimeout(loop, dur * 1000);
  };
  loop();
}

// ------------------------------------------------------------------ mulai
await useView(savedView());
renderAgents();
if (new URLSearchParams(window.location.search).has("demo")) {
  window.aiOffice = office; // memudahkan inspeksi di console saat demo
  runDemo();
} else {
  setInterval(refreshStatus, 5000);
  refreshStatus();
  refreshJobs();
  connect();
}
// pastikan modul suara dimuat (bunyi klik global + tombol SOUND)
void sfx;
