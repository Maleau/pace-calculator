"use strict";

// ---- Constantes ----
const PACE_MIN = 120; // 2:00 /km
const PACE_MAX = 600; // 10:00 /km
const DEFAULT_PACE = 360; // 6:00 /km, appliquée à chaque changement de distance
const DEFAULT_SPLIT = 1; // km
const TIME_SLIDER_STEP = 60; // 1 min
const DIST_MIN = 0.1;
const DIST_MAX = 50;
const HALF_KM = 21.0975;
const MARATHON_KM = 42.195;
const MAX_SPLIT_ROWS = 1000;

const RACE_NAMES = [
  { km: HALF_KM, name: "Semi-marathon" },
  { km: MARATHON_KM, name: "Marathon" },
];

// ---- État ----
const state = {
  distanceKm: 10,
  paceSec: DEFAULT_PACE, // s/km, float
  timeSec: DEFAULT_PACE * 10, // s, float
  splitKm: DEFAULT_SPLIT,
};

// ---- Fonctions pures ----
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const sameKm = (a, b) => Math.abs(a - b) < 1e-6;
const pad2 = (n) => String(n).padStart(2, "0");

/** Découpe un nombre de secondes (arrondi à la seconde) en h / min / s. */
function splitHMS(totalSec) {
  const t = Math.max(0, Math.round(totalSec));
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/** 3725 → "1:02:05", 300 → "5:00" */
function formatHMS(totalSec) {
  const { h, m, s } = splitHMS(totalSec);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Format lisible : "45min", "45min30s", "1h45min", "3h09min53s" */
function formatHuman(totalSec) {
  const { h, m, s } = splitHMS(totalSec);
  let out = h > 0 ? `${h}h${pad2(m)}min` : `${m}min`;
  if (s > 0) out += `${pad2(s)}s`;
  return out;
}

const computePace = (timeSec, km) => timeSec / km;
const computeTime = (paceSec, km) => paceSec * km;

function formatKm(km) {
  return (Math.round(km * 10000) / 10000).toLocaleString("fr-FR", { maximumFractionDigits: 4 });
}

function formatSpeed(paceSec) {
  return (3600 / paceSec).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Libellé de distance : "10 km", "Semi-marathon", "Marathon" */
function distanceLabel(km) {
  const race = RACE_NAMES.find((r) => sameKm(r.km, km));
  return race ? race.name : `${formatKm(km)} km`;
}

/** Temps de passage tous les `step` km, + le semi pour un marathon, + l'arrivée. */
function buildSplits(distanceKm, paceSec, step) {
  const rows = [];
  for (let i = 1; i * step < distanceKm - 1e-9 && rows.length < MAX_SPLIT_ROWS; i++) {
    rows.push({ km: i * step, type: "split" });
  }
  if (sameKm(distanceKm, MARATHON_KM)) {
    const existing = rows.find((r) => sameKm(r.km, HALF_KM));
    if (existing) existing.type = "milestone";
    else rows.push({ km: HALF_KM, type: "milestone" });
    rows.sort((a, b) => a.km - b.km);
  }
  rows.push({ km: distanceKm, type: "finish" });
  return rows.map((r) => ({ ...r, time: paceSec * r.km }));
}

// ---- Mises à jour d'état ----
function setPace(sec) {
  state.paceSec = clamp(sec, PACE_MIN, PACE_MAX);
  state.timeSec = computeTime(state.paceSec, state.distanceKm);
}

function setTime(sec) {
  const km = state.distanceKm;
  state.timeSec = clamp(sec, PACE_MIN * km, PACE_MAX * km);
  state.paceSec = computePace(state.timeSec, km);
}

/** Nouvelle distance : on repart sur 6:00 /km et des passages tous les 1 km. */
function setDistance(km) {
  state.distanceKm = km;
  state.paceSec = DEFAULT_PACE;
  state.timeSec = computeTime(DEFAULT_PACE, km);
  state.splitKm = DEFAULT_SPLIT;
}

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);
const el = {
  distance: $("#distance"),
  distanceError: $("#distance-error"),
  presets: document.querySelectorAll(".preset"),
  distSteps: document.querySelectorAll(".dist-step"),
  distanceSlider: $("#distance-slider"),
  timeSlider: $("#time-slider"),
  paceSlider: $("#pace-slider"),
  timeGroup: $('.steppers[data-target="time"]'),
  paceGroup: $('.steppers[data-target="pace"]'),
  resultPace: $("#result-pace"),
  resultRecap: $("#result-recap"),
  splitInterval: $("#split-interval"),
  splitsBody: $("#splits-body"),
  themeToggle: $("#theme-toggle"),
};

const fieldsOf = (group) => [...group.querySelectorAll("input")];

/** Remplit les champs h/min/s ou min/s à partir d'un total en secondes. */
function fillFields(group, totalSec) {
  let rest = Math.round(totalSec);
  fieldsOf(group).forEach((input, i) => {
    const mult = Number(input.dataset.mult);
    const v = Math.floor(rest / mult);
    rest -= v * mult;
    // Le premier champ (h ou min) n'est pas paddé, les suivants sur 2 chiffres
    input.value = i === 0 ? v : pad2(v);
  });
}

/** Lit le total en secondes depuis les champs (les débordements, ex. 75 s, sont acceptés). */
function readFields(group) {
  return fieldsOf(group).reduce((sum, input) => {
    const v = Number(input.value);
    return sum + (Number.isFinite(v) ? v : 0) * Number(input.dataset.mult);
  }, 0);
}

function render() {
  const { distanceKm: km, paceSec, timeSec } = state;

  // Distance
  el.presets.forEach((b) => b.classList.toggle("active", sameKm(Number(b.dataset.km), km)));
  el.distanceSlider.value = km;

  // Temps (slider au pas de 1 min)
  el.timeSlider.min = Math.ceil((PACE_MIN * km) / TIME_SLIDER_STEP) * TIME_SLIDER_STEP;
  el.timeSlider.max = Math.floor((PACE_MAX * km) / TIME_SLIDER_STEP) * TIME_SLIDER_STEP;
  el.timeSlider.value = Math.round(timeSec);
  fillFields(el.timeGroup, timeSec);

  // Allure (slider au pas de 5 s)
  el.paceSlider.value = Math.round(paceSec);
  fillFields(el.paceGroup, paceSec);

  // Résultats
  el.resultPace.textContent = formatHMS(paceSec);
  el.resultRecap.innerHTML = "";
  const strong = (txt) => Object.assign(document.createElement("strong"), { textContent: txt });
  const speed = Object.assign(document.createElement("span"), {
    className: "speed",
    textContent: ` (${formatSpeed(paceSec)} km/h)`,
  });
  el.resultRecap.append(
    strong(distanceLabel(km)),
    " en ",
    strong(formatHuman(timeSec)),
    " = ",
    strong(`${formatHMS(paceSec)} /km`),
    speed
  );

  el.splitInterval.value = state.splitKm;
  el.splitsBody.replaceChildren(
    ...buildSplits(km, paceSec, state.splitKm).map((row) => {
      const tr = document.createElement("tr");
      if (row.type !== "split") tr.className = row.type;
      const tdKm = document.createElement("td");
      tdKm.textContent =
        row.type === "milestone" ? `Semi (${formatKm(row.km)} km)` : `${formatKm(row.km)} km`;
      const tdTime = document.createElement("td");
      tdTime.textContent = formatHMS(row.time);
      tr.append(tdKm, tdTime);
      return tr;
    })
  );
}

// ---- Événements ----
function parseNum(str) {
  return Number(String(str).replace(",", "."));
}

function applyDistance(km) {
  const valid = Number.isFinite(km) && km >= DIST_MIN && km <= DIST_MAX;
  el.distanceError.hidden = valid;
  if (!valid) return;
  setDistance(km);
  render();
}

el.presets.forEach((b) =>
  b.addEventListener("click", () => {
    const km = Number(b.dataset.km);
    el.distance.value = km;
    applyDistance(km);
  })
);

// ± 1 km : on cale sur l'entier (21,0975 → 22 ou 21)
el.distSteps.forEach((b) =>
  b.addEventListener("click", () => {
    const km = state.distanceKm;
    const next = Number(b.dataset.distDelta) > 0 ? Math.floor(km + 1e-9) + 1 : Math.ceil(km - 1e-9) - 1;
    const clamped = clamp(next, 1, DIST_MAX);
    el.distance.value = clamped;
    applyDistance(clamped);
  })
);

el.distanceSlider.addEventListener("input", () => {
  const km = Number(el.distanceSlider.value);
  el.distance.value = km;
  applyDistance(km);
});

el.distance.addEventListener("input", () => applyDistance(parseNum(el.distance.value)));
el.distance.addEventListener("change", () => {
  if (el.distanceError.hidden) el.distance.value = state.distanceKm;
});

el.timeSlider.addEventListener("input", () => { setTime(Number(el.timeSlider.value)); render(); });
el.paceSlider.addEventListener("input", () => { setPace(Number(el.paceSlider.value)); render(); });

/** Branche un groupe de champs (+/− et saisie) sur un setter. */
function wireGroup(group, getTotal, setTotal) {
  group.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-delta]");
    if (!btn) return;
    const input = btn.parentElement.querySelector("input");
    const delta = Number(btn.dataset.delta) * Number(input.dataset.mult);
    setTotal(Math.round(getTotal()) + delta);
    render();
  });
  group.addEventListener("change", (e) => {
    if (e.target.matches("input")) {
      setTotal(readFields(group));
      render();
    }
  });
  group.addEventListener("keydown", (e) => {
    if (e.target.matches("input") && e.key === "Enter") e.target.blur();
  });
}

wireGroup(el.timeGroup, () => state.timeSec, setTime);
wireGroup(el.paceGroup, () => state.paceSec, setPace);

el.splitInterval.addEventListener("change", () => {
  const v = parseNum(el.splitInterval.value);
  if (Number.isFinite(v) && v >= 0.1) state.splitKm = v;
  render();
});

// ---- Thème clair / sombre ----
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function currentTheme() {
  return document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");
}

function renderThemeToggle() {
  el.themeToggle.checked = currentTheme() === "dark";
}

el.themeToggle.addEventListener("change", () => {
  const next = el.themeToggle.checked ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (e) {}
  renderThemeToggle();
});
systemDark.addEventListener("change", renderThemeToggle);

setDistance(state.distanceKm);
renderThemeToggle();
render();
