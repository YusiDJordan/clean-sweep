// Upgrade points + upgrades. Saved per player in this browser (localStorage); the game works without it.
import { G } from './state.js';
import { setMopHandle } from './tools.js';

const KEY = 'cleansweep.progress.v1';
export const UPGRADES = [
  { id: 'power', name: 'Mop Handle', desc: 'A tougher handle: harder hits, bigger knockback', icon: 'mop', tiers: ['Plastic · 75% hit power', 'Aluminium · 100% hit power', 'Iron · 125% hit power', 'Titanium · 150% hit power', 'Platinum · 180% hit power'], cost: [1, 1, 1, 1] },
  { id: 'grit', name: 'Health', desc: 'Take an extra hit before going down', icon: 'heart', slam: true, tiers: ['3 hits', '4 hits', '5 hits', '6 hits'], cost: [1, 1, 1] },
  { id: 'takedown', name: 'Takedowns', desc: 'Store up more Mop Takedowns (left + right click)', icon: 'takedown', slam: true, tiers: ['1 Takedown', '2 Takedowns', '3 Takedowns'], cost: [1, 1] },
  { id: 'speed', name: 'Stamina', desc: 'Run for longer, roll more often', icon: 'lungs', tiers: ['Normal stamina', '+25% stamina', '+50% stamina', '+80% stamina', '+120% stamina'], cost: [1, 1, 1, 1] }, // (id kept: old saves keep their level)
  { id: 'roll', name: 'Dodge', desc: 'A better roll: faster, further, and robbers in the way go down', icon: 'bowl', tiers: ['Roll · rolls past robbers', 'Power Roll · faster and longer, knocks a robber out', 'Strike! · bowls over a whole group'], cost: [1, 1] },
];
export const HANDLES = ['Plastic', 'Aluminium', 'Iron', 'Titanium', 'Platinum'];

// Upgrades work like levelling up: everything he does earns experience (XP); every level up gives one upgrade point (▲),
// and every upgrade costs exactly one. P.points = unspent upgrade points, P.xp = all the XP he's ever earned.
export const P = { points: 0, xp: 0, lv: { power: 0, speed: 0, reach: 0, hands: 0, takedown: 0, grit: 0, roll: 0 }, runs: 0, best: 0, v: 2 };
export const xpNeed = n => 140 + 30 * n; // (a level's XP is ~150 for a scrappy job, ~320 for a perfect one: one, at most two, upgrades per level) // XP from level n to level n+1
export function levelInfo(xp = P.xp) { let n = 0, rest = xp; while (rest >= xpNeed(n)) { rest -= xpNeed(n); n++; } return { level: n + 1, into: rest, need: xpNeed(n) }; }
// earn XP: returns how many level ups (= upgrade points) it brought
export function addXP(amount) { const l0 = levelInfo().level; P.xp += Math.max(0, amount | 0); const ups = levelInfo().level - l0; P.points += ups; return ups; }
export function loadProgress() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d) { P.points = (d.points ?? d.wages) | 0; P.xp = d.xp | 0;
    if ((d.v | 0) < 2) { const old = P.points; P.points = 0; P.xp = 0; addXP(old); } // (an older save: its unspent stars become XP)
    Object.assign(P.lv, d.lv || {}); for (const k of ['reach', 'hands']) if (P.lv[k] > 0) { P.points += P.lv[k]; P.lv[k] = 0; } /* (Leap and Quick Hands are gone: their points come back) */ P.runs = (d.runs ?? d.shifts) | 0; P.best = d.best | 0; P.secrets = Array.isArray(d.secrets) ? d.secrets : []; P.reached = d.reached || null; } } catch (e) {}
  computeStats();
}
// new game: no points, no upgrades, a fresh Karim
export function resetProgress() {
  P.points = 0; P.xp = 0; P.runs = 0; P.best = 0; P.secrets = []; P.reached = null; for (const k in P.lv) P.lv[k] = 0;
  saveProgress(); computeStats();
}
export const hasSave = () => P.runs > 0 || P.points > 0 || P.xp > 0 || !!P.reached || Object.values(P.lv).some(v => v);
export function saveProgress() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} showSaving(); }
let saveT = null;
function showSaving() { // AUTO SAVING, in red, where LOADING shows
  const el = typeof document !== 'undefined' && document.getElementById('saveword'); if (!el) return;
  el.classList.add('on'); clearTimeout(saveT); saveT = setTimeout(() => el.classList.remove('on'), 1800);
}

export function computeStats() {
  const L = P.lv; L.takedown = L.takedown | 0; L.roll = L.roll | 0;
  G.ps = {
    power: [0.75, 1.0, 1.25, 1.5, 1.8][L.power],
    speed: 4.4, // (one pace for everyone: the upgrade is stamina now)
    stamina: [108, 135, 162, 195, 240][L.speed], // (60% of what it was: he starts out shorter of breath) // how long he can run (and how many rolls in a row)
    dodge: 0.9, // roll length (the Dodge upgrade makes it longer now, not stamina)
    reach: 3.0, // how far off he'll dash in at a robber with a swing (was 4.5 m and up: too strong)
    lunge: 6.4, // lunge speed, m/s
    atk: 1.0,
    charges: [1, 2, 3][L.takedown], // takedowns he can store up
    bowl: L.roll > 0, // (Power Roll: the roll knocks a robber out)
    bowlAll: L.roll > 1, // (Strike!: it knocks out everyone it rolls through)
    rollSpd: L.roll > 0 ? 1.35 : 1, // (faster, and so longer)
    hp: [3, 4, 5, 6][L.grit],          // hits he can take
    regen: [1 / 9, 1 / 8, 1 / 7, 1 / 6][L.grit], // hits earned back per second (after 6 s without being hit)
  };
  setMopHandle(L.power); // (the handle he's earned)
  return G.ps;
}
export function buy(id) {
  const u = UPGRADES.find(x => x.id === id), lv = P.lv[id];
  if (!u || lv >= u.cost.length) return false;
  const c = u.cost[lv]; if (P.points < c) return false;
  P.points -= c; P.lv[id] = lv + 1; saveProgress(); computeStats(); return true;
}
// upgrade points earned for a finished level
export function pointsFor(run) {
  // XP is mostly about the job: about 60% for cleaning, 40% for the fight (a perfect level ~320 XP)
  const base = 20, ko = Math.round(90 * run.kos / Math.max(1, run.total || run.kos)), combo = Math.min(20, run.maxCombo), perfect = Math.min(5, run.perfect) * 4;
  const clean = Math.round(run.clean * 1.8);
  const docked = Math.round(run.damage / 400); // (breakages cost a little)
  const total = Math.max(30, base + ko + combo + perfect + clean - docked);
  return { base, ko, combo, perfect, clean, docked, total };
}
export function bank(amount, score) { const ups = addXP(amount); P.runs++; P.best = Math.max(P.best, score | 0); saveProgress(); return ups; }

// ---------- shop UI ----------
export function renderShop(el, onChange) {
  const rows = UPGRADES.map(u => {
    const lv = P.lv[u.id], max = u.cost.length, cost = lv < max ? u.cost[lv] : null;
    const pips = Array.from({ length: max + 1 }, (_, i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('');
    const btn = cost === null ? '<button class="ghost" disabled>Maxed</button>' : `<button data-buy="${u.id}" ${P.points < cost ? 'disabled' : ''}>★ ${cost}</button>`;
    return `<div class="upg"><div class="uinfo"><b>${u.name}</b><span>${u.desc}</span><div class="pips">${pips}</div>
      <small>Now: ${u.tiers[lv]}${cost !== null ? ` · Next: ${u.tiers[lv + 1]}` : ''}</small></div>${btn}</div>`;
  }).join('');
  el.innerHTML = `<div class="wallet">Upgrade points <b>★ ${P.points.toLocaleString()}</b></div>${rows}`;
  el.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => { if (buy(b.dataset.buy)) { renderShop(el, onChange); onChange && onChange(); } }));
}
