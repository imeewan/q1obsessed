/* =========================================================
   Q1obsessed // ARCADE — game front-end
   Modules: utils · SFX (WebAudio blips) · FX (canvas particles)
            juice (flash/shake/combo) · API · search · journal card
            party bench · VS battle · boot
   Vanilla JS, no dependencies. All data from local /api/*.
   ========================================================= */
"use strict";

/* ---------- DOM handles ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const stage = $("#stage");
const input = $("#searchInput");
const sugList = $("#suggestions");
const benchEl = $("#bench");
const benchSlots = $("#benchSlots");
const benchCount = $("#benchCount");
const fightBtn = $("#fightBtn");
const comboEl = $("#combo");
const comboNEl = $("#comboN");
const flashEl = $("#flash");
const toastEl = $("#toast");

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const HOWTO_HTML = stage.innerHTML; // attract screen, restored when stage clears

/* ---------- constants ---------- */
const TRY_JOURNALS = [
  "Nature", "Cell", "ACS Omega", "PLOS ONE", "Bioinformatics", "Science",
  "The Lancet", "Journal of the American Chemical Society", "Scientific Reports",
];

const TIERS = {
  legendary: { key: "legendary", label: "LEGENDARY", why: "TOP-5 RANK IN A FIELD" },
  epic:      { key: "epic",      label: "EPIC",      why: "TOP-10 RANK IN A FIELD" },
  rare:      { key: "rare",      label: "RARE",      why: "QUARTILE 1" },
  uncommon:  { key: "uncommon",  label: "UNCOMMON",  why: "QUARTILE 2" },
  common:    { key: "common",    label: "COMMON",    why: "QUARTILE 3" },
  basic:     { key: "basic",     label: "BASIC",     why: "QUARTILE 4" },
};

const GOLD = ["#ffd35c", "#ff9d2f", "#fff3c4", "#ffffff"];
const NEON = ["#ff2d95", "#2de2ff", "#b693ff", "#7ad9ff", "#5ee0c0"];

/* ---------- utils ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtInt = (n) => Number(n).toLocaleString("en-US");
const fmtNum = (v) => v == null ? "—" :
  Number(v).toLocaleString("en-US", { maximumFractionDigits: 3 });
const fmtPct = (p) => p == null ? "—" : Number(p).toFixed(1);
const fmtIssn = (issn) => !issn ? "" :
  String(issn).split(",").map((x) => x.trim())
    .filter(Boolean).map((x) => x.length === 8 ? x.slice(0, 4) + "-" + x.slice(4) : x)
    .join(", ");

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* =========================================================
   SFX — tiny WebAudio chiptune blips (no assets)
   ========================================================= */
const Sfx = {
  ctx: null,
  on: localStorage.getItem("arcadeSound") !== "off",

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },

  note(freq, t0, dur, type = "square", vol = 0.04) {
    if (!this.on || !this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  },

  play(seq, type = "square", vol = 0.04) { // seq: [[freq, offset, dur], ...]
    this.ensure();
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [f, off, dur] of seq) this.note(f, now + off, dur, type, vol);
  },

  tick()    { this.play([[1175, 0, 0.03]], "square", 0.02); },
  type()    { this.play([[880, 0, 0.02]], "square", 0.012); },
  pop()     { this.play([[392, 0, 0.06], [587, 0.05, 0.08]]); },
  pull()    { this.play([[262, 0, 0.07], [392, 0.07, 0.07], [523, 0.14, 0.12]]); },
  hit()     { this.play([[160, 0, 0.09]], "sawtooth", 0.05); },
  win()     { this.play([[523, 0, 0.08], [659, 0.08, 0.08], [784, 0.16, 0.14]]); },
  jackpot() { this.play([[523, 0, 0.09], [659, 0.09, 0.09], [784, 0.18, 0.09], [1047, 0.27, 0.22]]); },
  fight()   { this.play([[110, 0, 0.12], [147, 0.1, 0.12], [220, 0.2, 0.18]], "sawtooth", 0.05); },
  deny()    { this.play([[180, 0, 0.08], [120, 0.08, 0.12]], "sawtooth", 0.04); },
};

const muteBtn = $("#muteBtn");
function syncMuteBtn() {
  muteBtn.textContent = "SOUND: " + (Sfx.on ? "ON" : "OFF");
  muteBtn.setAttribute("aria-pressed", String(!Sfx.on));
}
muteBtn.addEventListener("click", () => {
  Sfx.on = !Sfx.on;
  localStorage.setItem("arcadeSound", Sfx.on ? "on" : "off");
  syncMuteBtn();
  if (Sfx.on) Sfx.pop();
});
syncMuteBtn();
window.addEventListener("pointerdown", () => Sfx.ensure(), { once: true });
window.addEventListener("keydown", () => Sfx.ensure(), { once: true });

/* =========================================================
   FX — canvas particle system (hard-capped, perf-safe)
   ========================================================= */
const FX = (() => {
  const cv = $("#fx");
  const cx = cv.getContext("2d");
  const MAX = 360;                    // hard cap on live particles
  let parts = [];
  let raf = null;
  let W = 0, H = 0;

  function resize() {
    W = cv.width = window.innerWidth;
    H = cv.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  function loop() {
    cx.clearRect(0, 0, W, H);
    const alive = [];
    for (const p of parts) {
      p.life++;
      if (p.life >= p.max) continue;
      p.vy += p.g;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      const fade = 1 - p.life / p.max;
      cx.globalAlpha = fade;
      cx.fillStyle = p.color;
      const s = p.size * (0.5 + fade * 0.5);
      cx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      alive.push(p);
    }
    cx.globalAlpha = 1;
    parts = alive;
    raf = parts.length ? requestAnimationFrame(loop) : null;
    if (!raf) cx.clearRect(0, 0, W, H);
  }

  function burst(x, y, opts = {}) {
    if (REDUCED) return;
    const {
      count = 36, colors = NEON, speed = 6.5, gravity = 0.14,
      life = [35, 70], size = [2, 6], up = 0.55,
    } = opts;
    const room = MAX - parts.length;
    const n = Math.max(0, Math.min(count, room));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.25 + Math.random() * 0.75) * speed;
      parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * up,
        g: gravity,
        size: size[0] + Math.random() * (size[1] - size[0]),
        color: colors[(Math.random() * colors.length) | 0],
        life: 0,
        max: life[0] + Math.random() * (life[1] - life[0]),
      });
    }
    if (!raf && parts.length) raf = requestAnimationFrame(loop);
  }

  function burstAt(el, opts) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, opts);
  }

  return { burst, burstAt };
})();

/* ---------- juice helpers ---------- */
function screenFlash(gold = false) {
  if (REDUCED) return;
  flashEl.classList.toggle("gold", gold);
  flashEl.classList.remove("go");
  void flashEl.offsetWidth; // restart animation
  flashEl.classList.add("go");
}

function screenShake() {
  if (REDUCED) return;
  document.body.classList.remove("shake");
  void document.body.offsetWidth;
  document.body.classList.add("shake");
  setTimeout(() => document.body.classList.remove("shake"), 400);
}

/* combo counter — pure flavor */
let combo = 0;
let comboTimer = null;
function bumpCombo() {
  combo++;
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => { combo = 0; comboEl.hidden = true; }, 18000);
  if (combo >= 2) {
    comboEl.hidden = false;
    comboNEl.textContent = "x" + combo;
    comboEl.classList.remove("bump");
    void comboEl.offsetWidth;
    comboEl.classList.add("bump");
  }
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4200);
}

/* =========================================================
   API
   ========================================================= */
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function connectionLost() {
  Sfx.deny();
  toast("GAME OVER — CONNECTION LOST. CHECK THE SERVER AND TRY AGAIN.");
}

/* ---------- stats marquee ---------- */
async function loadStats() {
  try {
    const s = await api("/api/stats");
    const bits = [
      `${fmtInt(s.sjr_journals)} SJR JOURNALS`,
      `${fmtInt(s.scopus_journals)} SCOPUS CITESCORE JOURNALS`,
      `${fmtInt(s.sjr_categories)} FIELDS`,
      s.scopus_loaded ? "BOTH DATABASES ONLINE" : "WARNING: SCOPUS OFFLINE",
      "TYPO-TOLERANT SEARCH", "INSERT QUERY TO START",
    ];
    const text = "★ " + bits.join(" ★ ") + " ★ ";
    $("#marquee").innerHTML =
      `<span>${esc(text)}</span><span aria-hidden="true">${esc(text)}</span>`;
  } catch {
    $("#marquee").innerHTML = "<span>★ OFFLINE ★&nbsp;</span><span>★ OFFLINE ★&nbsp;</span>";
  }
}

/* =========================================================
   Rarity / power scoring
   ========================================================= */
function computeRarity(metrics) {
  let minRank = Infinity;
  let bestQ = 5;
  for (const src of ["sjr", "scopus"]) {
    const m = metrics[src];
    if (!m) continue;
    if (m.best_quartile) bestQ = Math.min(bestQ, m.best_quartile);
    for (const c of m.categories || []) {
      if (c.rank) minRank = Math.min(minRank, c.rank);
      if (c.quartile) bestQ = Math.min(bestQ, c.quartile);
    }
  }
  if (minRank <= 5) return TIERS.legendary;
  if (minRank <= 10) return TIERS.epic;
  if (bestQ === 1) return TIERS.rare;
  if (bestQ === 2) return TIERS.uncommon;
  if (bestQ === 3) return TIERS.common;
  return TIERS.basic;
}

function computePower(metrics) {
  let best = 0;
  for (const src of ["sjr", "scopus"]) {
    const m = metrics[src];
    if (m && m.best_percentile != null) best = Math.max(best, m.best_percentile);
  }
  return Math.round(best * 10); // e.g. 99.8 pctl -> 998 PWR
}

function hasRankOne(metrics) {
  return ["sjr", "scopus"].some((src) =>
    (metrics[src]?.categories || []).some((c) => c.rank === 1));
}

function countGoldFields(metrics) {
  let n = 0;
  for (const src of ["sjr", "scopus"]) {
    for (const c of metrics[src]?.categories || []) if (c.quartile === 1) n++;
  }
  return n;
}

/* =========================================================
   Search — live suggestions, keyboard nav
   ========================================================= */
let sugItems = [];      // current results
let sugIndex = -1;      // keyboard-highlighted row
let searchSeq = 0;      // race guard

function pickSource(sources) {
  if (sources.sjr != null) return { source: "sjr", id: sources.sjr };
  if (sources.scopus != null) return { source: "scopus", id: sources.scopus };
  return null;
}

function hideSuggestions() {
  sugList.hidden = true;
  sugList.innerHTML = "";
  sugItems = [];
  sugIndex = -1;
  input.setAttribute("aria-expanded", "false");
}

function renderSuggestions(results) {
  sugItems = results;
  sugIndex = results.length ? 0 : -1;
  if (!results.length) {
    sugList.innerHTML = `<li class="none">NO PLAYER FOUND — TRY ANOTHER NAME</li>`;
  } else {
    sugList.innerHTML = results.map((r, i) => {
      const badges =
        (r.sources.sjr != null ? `<span class="src-badge sjr">SJR</span>` : "") +
        (r.sources.scopus != null ? `<span class="src-badge scopus">SCOPUS</span>` : "");
      return `<li role="option" id="sug-${i}" data-i="${i}" class="${i === sugIndex ? "active" : ""}"
                  aria-selected="${i === sugIndex}">
                <span class="sel-cursor">►</span>
                <span class="sug-title">${esc(r.title)}</span>${badges}
              </li>`;
    }).join("");
  }
  sugList.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function moveSuggestion(delta) {
  if (!sugItems.length) return;
  sugIndex = (sugIndex + delta + sugItems.length) % sugItems.length;
  sugList.querySelectorAll("li").forEach((li, i) => {
    li.classList.toggle("active", i === sugIndex);
    li.setAttribute("aria-selected", String(i === sugIndex));
    if (i === sugIndex) li.scrollIntoView({ block: "nearest" });
  });
  Sfx.tick();
}

function chooseSuggestion(i) {
  const r = sugItems[i];
  if (!r) return;
  const ref = pickSource(r.sources);
  if (!ref) return;
  input.value = r.title;
  hideSuggestions();
  openJournal(ref.source, ref.id);
}

const doSearch = debounce(async (q) => {
  const seq = ++searchSeq;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}&limit=10`);
    if (seq !== searchSeq || document.activeElement !== input) return;
    renderSuggestions(data.results || []);
  } catch {
    if (seq === searchSeq) hideSuggestions();
  }
}, 160);

input.addEventListener("input", () => {
  Sfx.type();
  const q = input.value.trim();
  if (q.length < 2) { hideSuggestions(); searchSeq++; return; }
  doSearch(q);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveSuggestion(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggestion(-1); }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (!sugList.hidden && sugIndex >= 0) chooseSuggestion(sugIndex);
    else if (input.value.trim().length >= 2) quickPlay(input.value.trim());
  } else if (e.key === "Escape") hideSuggestions();
});

input.addEventListener("blur", () => setTimeout(hideSuggestions, 150));

sugList.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li[data-i]");
  if (!li) return;
  e.preventDefault(); // keep input focus until we choose
  chooseSuggestion(Number(li.dataset.i));
});

/* "/" anywhere focuses the search — arcade quality-of-life */
window.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
    input.select();
  }
});

/* try chips: search and open the best match directly */
async function quickPlay(name) {
  input.value = name;
  hideSuggestions();
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(name)}&limit=5`);
    const first = (data.results || []).find((r) => pickSource(r.sources));
    if (!first) { Sfx.deny(); toast("NO PLAYER FOUND — TRY ANOTHER NAME"); return; }
    const ref = pickSource(first.sources);
    openJournal(ref.source, ref.id);
  } catch {
    connectionLost();
  }
}

const tryChips = $("#tryChips");
tryChips.innerHTML = TRY_JOURNALS.map(
  (t) => `<button class="chip" type="button" data-name="${esc(t)}">${esc(t)}</button>`).join("");
tryChips.addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (b) { Sfx.tick(); quickPlay(b.dataset.name); }
});

/* =========================================================
   Journal detail — the card pull
   ========================================================= */
let lastCardRef = null; // {source, id} of the open card, for battle BACK

function catRowHtml(c, i) {
  const q = c.quartile || 4;
  const pct = Math.max(0, Math.min(100, c.percentile ?? 0));
  const first = c.rank === 1;
  return `
    <div class="cat-row">
      <div class="cat-line1">
        <span class="cat-name">${esc(c.category)}</span>
        <span class="q-chip q${q}">Q${q}</span>
        <span class="cat-rank ${first ? "is-first" : ""}">RANK <b>#${fmtInt(c.rank)}${first ? " ★" : ""}</b>/${fmtInt(c.total)}</span>
      </div>
      <div class="xp-line">
        <div class="xp"><div class="xp-fill q${q}" style="--w:${pct}%; transition-delay:${Math.min(i * 90, 900)}ms"></div></div>
        <div class="xp-pct">${fmtPct(c.percentile)}<small>PCTL</small></div>
      </div>
    </div>`;
}

function panelHtml(src, m) {
  const label = src === "sjr" ? "SJR" : "SCOPUS";
  if (!m) {
    return `
      <div class="panel ${src}">
        <div class="panel-head"><span class="panel-name">${label}</span></div>
        <div class="panel-empty">NOT FOUND IN THIS DATABASE<br>— NO DATA —</div>
      </div>`;
  }
  const subBits = [];
  if (m.h_index != null) subBits.push(`<span>H-INDEX <b>${fmtInt(m.h_index)}</b></span>`);
  if (m.best_quartile != null) subBits.push(`<span>BEST <b>Q${m.best_quartile}</b></span>`);
  if (m.best_percentile != null) subBits.push(`<span>PEAK <b>${fmtPct(m.best_percentile)} PCTL</b></span>`);
  if (m.country) subBits.push(`<span><b>${esc(m.country)}</b></span>`);
  if (m.coverage) subBits.push(`<span>COVERAGE <b>${esc(m.coverage)}</b></span>`);
  const cats = m.categories || [];
  return `
    <div class="panel ${src}">
      <div class="panel-head">
        <span class="panel-name">${label}</span>
        <span class="panel-metric">${esc(m.metric_name)} <b>${fmtNum(m.metric_value)}</b></span>
      </div>
      <div class="panel-sub">${subBits.join("")}</div>
      ${cats.length
        ? cats.map(catRowHtml).join("")
        : `<div class="panel-empty">NO FIELD DATA</div>`}
    </div>`;
}

function renderDetail(data, ref) {
  lastCardRef = ref;
  const m = data.metrics || {};
  const tier = computeRarity(m);
  const power = computePower(m);
  const jackpot = hasRankOne(m);
  const inParty = bench.some((b) => b.key === ref.source + ":" + ref.id);
  const meta = m.sjr || m.scopus || {};

  const metaBits = [];
  if (data.publisher) metaBits.push(`<b>${esc(data.publisher)}</b>`);
  if (meta.type) metaBits.push(esc(String(meta.type).toUpperCase()));
  if (data.issn) metaBits.push("ISSN " + esc(fmtIssn(data.issn)));

  stage.innerHTML = `
    <div class="card-scene">
      <article class="jcard tier-${tier.key}" id="jcard">
        <div class="jcard-inner">
          <div class="jcard-back"><div class="jcard-back-logo">Q1</div></div>
          <div class="jcard-front">
            <div class="foil"></div>
            <div class="jcard-top">
              <div style="min-width:0">
                <div>
                  <span class="rarity-tag">${tier.label}</span>
                  <span class="rarity-why">${tier.why}</span>
                </div>
                <h2 class="jcard-title">${esc(data.title)}</h2>
                <div class="jcard-meta">${metaBits.join('<span class="sep">◆</span>')}</div>
                <button class="party-btn" id="partyBtn" type="button" ${inParty ? "disabled" : ""}>
                  ${inParty ? "✓ IN PARTY" : "+ ADD TO PARTY"}
                </button>
              </div>
              <div class="power-pod">
                <div class="power-num">${fmtInt(power)}</div>
                <div class="power-label">POWER</div>
              </div>
            </div>
            ${jackpot ? `<div class="jackpot">★ JACKPOT! RANKED #1 IN ITS FIELD ★</div>` : ""}
            <div class="panels">
              ${panelHtml("sjr", m.sjr)}
              ${panelHtml("scopus", m.scopus)}
            </div>
          </div>
        </div>
      </article>
    </div>`;

  const card = $("#jcard");
  $("#partyBtn").addEventListener("click", () => addToParty(data, ref, tier));

  // flip the card, then fire the juice once the front is visible
  requestAnimationFrame(() => requestAnimationFrame(() => {
    card.classList.add("revealed");
    const delay = REDUCED ? 0 : 520;
    setTimeout(() => {
      if (jackpot || tier.key === "legendary") {
        screenFlash(true);
        screenShake();
        Sfx.jackpot();
        FX.burstAt(card, { count: 120, colors: GOLD, speed: 9, up: 0.7, life: [50, 95] });
        setTimeout(() => FX.burstAt(card, { count: 80, colors: GOLD, speed: 7 }), 260);
      } else if (tier.key === "epic") {
        screenFlash(false);
        Sfx.win();
        FX.burstAt(card, { count: 90, colors: ["#d36bff", "#b693ff", "#ff2d95", "#fff"], speed: 8 });
      } else {
        Sfx.pop();
        FX.burstAt(card, { count: 30, colors: NEON, speed: 5 });
      }
    }, delay);
  }));

  stage.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
}

async function openJournal(source, id) {
  stage.innerHTML = `<div class="loading">DEALING CARD…</div>`;
  Sfx.pull();
  try {
    const data = await api(`/api/journal?source=${source}&id=${id}`);
    bumpCombo();
    updateHash(`j=${source}:${id}`); // deep-linkable card
    renderDetail(data, { source, id });
  } catch {
    stage.innerHTML = HOWTO_HTML;
    connectionLost();
  }
}

/* ---------- hash deep links (#j=sjr:20) ---------- */
let appliedHash = "";
function updateHash(h) {
  appliedHash = h;
  if (location.hash.slice(1) !== h) location.hash = h;
}
function routeFromHash() {
  const h = location.hash.slice(1);
  if (h === appliedHash) return;
  appliedHash = h;
  const mj = /^j=(sjr|scopus):(\d+)$/.exec(h);
  if (mj) { openJournal(mj[1], Number(mj[2])); return; }
  const mv = /^vs=((?:sjr|scopus):\d+(?:,(?:sjr|scopus):\d+){1,4})$/.exec(h);
  if (mv) { battleByIds(mv[1]); return; }
  if (!h) { clearBattleTimers(); stage.innerHTML = HOWTO_HTML; }
}
window.addEventListener("hashchange", routeFromHash);

/* =========================================================
   Party bench — collect 2–5 fighters
   ========================================================= */
const bench = []; // {key, source, id, title, tierKey, tierLabel}

function addToParty(data, ref, tier) {
  if (bench.length >= 5) { Sfx.deny(); toast("PARTY FULL — MAX 5 FIGHTERS"); return; }
  const key = ref.source + ":" + ref.id;
  if (bench.some((b) => b.key === key)) return;
  bench.push({ key, source: ref.source, id: ref.id, title: data.title, tierKey: tier.key, tierLabel: tier.label });
  Sfx.win();
  renderBench();
  const btn = $("#partyBtn");
  if (btn) { btn.disabled = true; btn.textContent = "✓ IN PARTY"; FX.burstAt(btn, { count: 24, colors: GOLD, speed: 4 }); }
}

function removeFromParty(key) {
  const i = bench.findIndex((b) => b.key === key);
  if (i >= 0) bench.splice(i, 1);
  Sfx.tick();
  renderBench();
  // re-enable the card button if its journal was just removed
  const btn = $("#partyBtn");
  if (btn && lastCardRef && key === lastCardRef.source + ":" + lastCardRef.id) {
    btn.disabled = false;
    btn.textContent = "+ ADD TO PARTY";
  }
}

function renderBench() {
  const show = bench.length > 0;
  benchEl.hidden = !show;
  document.body.classList.toggle("has-bench", show);
  benchCount.textContent = bench.length + "/5";
  fightBtn.disabled = bench.length < 2;
  benchSlots.innerHTML = bench.map((b) => `
    <div class="bench-card tier-${b.tierKey}">
      <span class="bench-card-title" data-open="${b.key}" title="${esc(b.title)}">${esc(b.title)}</span>
      <button class="bench-remove" type="button" data-remove="${b.key}" aria-label="Remove ${esc(b.title)}">✕</button>
    </div>`).join("");
}

benchSlots.addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove]");
  if (rm) { removeFromParty(rm.dataset.remove); return; }
  const open = e.target.closest("[data-open]");
  if (open) {
    const [source, id] = open.dataset.open.split(":");
    openJournal(source, Number(id));
  }
});

fightBtn.addEventListener("click", () => startBattle());

/* =========================================================
   VS battle
   ========================================================= */
const BATTLE_ROUNDS = [
  { name: "SJR POWER",     unit: "PCTL", get: (m) => m.sjr?.best_percentile ?? null,     fmt: fmtPct },
  { name: "SCOPUS POWER",  unit: "PCTL", get: (m) => m.scopus?.best_percentile ?? null,  fmt: fmtPct },
  { name: "SJR VALUE",     unit: "",     get: (m) => m.sjr?.metric_value ?? null,        fmt: fmtNum },
  { name: "CITESCORE",     unit: "",     get: (m) => m.scopus?.metric_value ?? null,     fmt: fmtNum },
  { name: "H-INDEX",       unit: "",     get: (m) => m.sjr?.h_index ?? null,             fmt: fmtNum },
  { name: "GOLD FIELDS",   unit: "Q1",   get: (m) => countGoldFields(m),                 fmt: fmtNum },
];

let battleTimers = [];
function clearBattleTimers() {
  battleTimers.forEach(clearTimeout);
  battleTimers = [];
}
function later(fn, ms) { battleTimers.push(setTimeout(fn, ms)); }

function startBattle() {
  if (bench.length < 2) return;
  battleByIds(bench.map((b) => b.key).join(","));
}

async function battleByIds(ids) {
  clearBattleTimers();
  stage.innerHTML = `<div class="loading">ENTERING THE ARENA…</div>`;
  Sfx.fight();
  try {
    const data = await api(`/api/compare?ids=${encodeURIComponent(ids)}`);
    updateHash("vs=" + ids); // deep-linkable battle
    renderBattle(data.items || []);
  } catch {
    stage.innerHTML = HOWTO_HTML;
    connectionLost();
  }
}

function renderBattle(items) {
  const fighters = items.map((it) => ({
    title: it.title,
    tier: computeRarity(it.metrics || {}),
    metrics: it.metrics || {},
    score: 0,
  }));

  // precompute rounds: values + winners (ties share the point)
  const rounds = BATTLE_ROUNDS.map((r) => {
    const vals = fighters.map((f) => r.get(f.metrics));
    const present = vals.filter((v) => v != null && !Number.isNaN(v));
    if (!present.length) return null;
    const max = Math.max(...present);
    return {
      def: r,
      vals,
      max,
      winners: vals.map((v) => v != null && v === max),
    };
  }).filter(Boolean);

  stage.innerHTML = `
    <div class="battle">
      <div class="battle-title">⚔ VS BATTLE ⚔</div>
      <div class="battle-bar">
        <button class="battle-btn" id="skipBtn" type="button">&#9193; SKIP</button>
        <button class="battle-btn" id="backBtn" type="button">&larr; BACK</button>
      </div>
      <div class="fighters" style="--n:${fighters.length}">
        ${fighters.map((f, i) => `
          <div class="fighter-plate tier-${f.tier.key}" id="plate-${i}">
            <div class="fighter-crown">\u{1F451}</div>
            <div class="fighter-name" title="${esc(f.title)}">${esc(f.title)}</div>
            <div class="fighter-tier">${f.tier.label}</div>
            <div class="fighter-score" id="score-${i}">0<small>ROUNDS WON</small></div>
          </div>`).join("")}
      </div>
      <div class="vs-spark">VS</div>
      <div id="roundsBox">
        ${rounds.map((r, ri) => `
          <div class="round" id="round-${ri}">
            <div class="round-name"><span class="round-no">ROUND ${ri + 1}</span>${esc(r.def.name)}${r.def.unit ? " · " + esc(r.def.unit) : ""}</div>
            ${fighters.map((f, fi) => {
              const v = r.vals[fi];
              const w = v == null ? 0 : Math.max(3, (v / r.max) * 100);
              return `
                <div class="hp-row" id="hp-${ri}-${fi}">
                  <span class="hp-who" title="${esc(f.title)}">${esc(f.title)}</span>
                  <div class="hp"><div class="hp-fill" data-w="${w}"></div></div>
                  <span class="hp-val ${v == null ? "none" : ""}">${v == null ? "NO DATA" : r.def.fmt(v)}</span>
                </div>`;
            }).join("")}
          </div>`).join("")}
      </div>
      <div class="battle-result" id="battleResult"></div>
    </div>`;

  $("#backBtn").addEventListener("click", () => {
    clearBattleTimers();
    Sfx.tick();
    if (lastCardRef) openJournal(lastCardRef.source, lastCardRef.id);
    else stage.innerHTML = HOWTO_HTML;
  });

  stage.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });

  /* --- play the rounds --- */
  const STEP = REDUCED ? 120 : 1150;
  const scores = fighters.map(() => 0);
  let finished = false;

  function playRound(ri, instant) {
    const r = rounds[ri];
    const el = $("#round-" + ri);
    if (!el) return;
    el.classList.add("live");
    el.querySelectorAll(".hp-fill").forEach((f) => {
      if (instant) f.style.transition = "none";
      requestAnimationFrame(() => { f.style.width = f.dataset.w + "%"; });
    });
    const settle = () => {
      r.winners.forEach((won, fi) => {
        if (!won) return;
        scores[fi]++;
        const row = $(`#hp-${ri}-${fi}`);
        row?.classList.add("win");
        const sc = $("#score-" + fi);
        if (sc) {
          sc.firstChild.textContent = scores[fi];
          sc.classList.remove("bump");
          void sc.offsetWidth;
          sc.classList.add("bump");
        }
        if (!instant) FX.burstAt(row?.querySelector(".hp"), { count: 16, colors: GOLD, speed: 4, up: 0.4 });
      });
      if (!instant) Sfx.hit();
    };
    if (instant) settle(); else later(settle, 700);
  }

  function finish(instant) {
    if (finished) return;
    finished = true;
    const top = Math.max(...scores);
    const champs = fighters.map((f, i) => ({ f, i })).filter((x) => scores[x.i] === top);
    champs.forEach((c) => $("#plate-" + c.i)?.classList.add("champion"));
    const resEl = $("#battleResult");
    resEl.textContent = champs.length > 1
      ? "★ DRAW GAME ★"
      : `★ WINNER: ${champs[0].f.title.toUpperCase()} ★`;
    resEl.classList.add("show");
    if (!instant) {
      Sfx.jackpot();
      screenFlash(true);
      screenShake();
      champs.forEach((c) =>
        FX.burstAt($("#plate-" + c.i), { count: Math.floor(110 / champs.length), colors: GOLD, speed: 8, up: 0.7 }));
    }
    const skip = $("#skipBtn");
    if (skip) skip.disabled = true;
  }

  rounds.forEach((_, ri) => later(() => playRound(ri, false), 400 + ri * STEP));
  later(() => finish(false), 400 + rounds.length * STEP + 500);

  $("#skipBtn").addEventListener("click", () => {
    clearBattleTimers();
    // reset any partial scores and replay everything instantly
    scores.forEach((_, i) => { scores[i] = 0; });
    fighters.forEach((_, i) => {
      const sc = $("#score-" + i);
      if (sc) sc.firstChild.textContent = "0";
    });
    document.querySelectorAll(".hp-row.win").forEach((el) => el.classList.remove("win"));
    rounds.forEach((_, ri) => playRound(ri, true));
    finish(true);
    Sfx.pop();
  });
}

/* =========================================================
   Boot
   ========================================================= */
loadStats();
routeFromHash(); // honor a #j=source:id deep link on load
if (window.matchMedia("(pointer: fine)").matches) input.focus();
