// Upgrade points + upgrades. Saved per player in this browser (localStorage); the game works without it.
import { G } from './state.js';

const KEY = 'cleansweep.progress.v1';
export const UPGRADES = [
  { id: 'power', name: 'Mop Power', desc: 'Harder hits, bigger knockback', tiers: ['75% damage', '100% damage', '125% damage', '150% damage', '180% damage'], cost: [120, 260, 450, 700] },
  { id: 'speed', name: 'Footwork', desc: 'Walk and run faster, slide further', tiers: ['Walk 2.3 · Run 5.3 m/s', 'Walk 2.6 · Run 5.9 m/s', 'Walk 2.8 · Run 6.5 m/s', 'Walk 3.1 · Run 7.1 m/s', 'Walk 3.4 · Run 7.7 m/s'], cost: [100, 220, 400, 650] },
  { id: 'reach', name: 'Leap', desc: 'Lunge at robbers from further away, faster', tiers: ['4.5 m lunge', '6 m lunge', '7.5 m lunge', '9 m lunge'], cost: [140, 300, 520] },
  { id: 'hands', name: 'Quick Hands', desc: 'Faster swings for longer combos', tiers: ['Normal', '+12% swing speed', '+25% swing speed', '+40% swing speed'], cost: [150, 320, 560] },
  { id: 'grit', name: 'Grit', desc: 'Take an extra hit', tiers: ['3 hits', '4 hits', '5 hits', '6 hits'], cost: [130, 280, 480] },
];

export const P = { points: 0, lv: { power: 0, speed: 0, reach: 0, hands: 0, grit: 0 }, runs: 0, best: 0 };
export function loadProgress() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d) { P.points = (d.points ?? d.wages) | 0; Object.assign(P.lv, d.lv || {}); P.runs = (d.runs ?? d.shifts) | 0; P.best = d.best | 0; } } catch (e) {}
  computeStats();
}
// new game: no points, no upgrades, a fresh Karim
export function resetProgress() {
  P.points = 0; P.runs = 0; P.best = 0; for (const k in P.lv) P.lv[k] = 0;
  saveProgress(); computeStats();
}
export function saveProgress() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} }

export function computeStats() {
  const L = P.lv;
  G.ps = {
    power: [0.75, 1.0, 1.25, 1.5, 1.8][L.power],
    speed: [4.4, 4.9, 5.4, 5.9, 6.4][L.speed],
    dodge: [0.85, 0.92, 1.0, 1.07, 1.15][L.speed],
    reach: [4.5, 6, 7.5, 9][L.reach],
    lunge: [6.4, 7.6, 8.8, 10][L.reach], // lunge speed, m/s (still quick, no longer a blur)
    atk: [1.0, 1.12, 1.25, 1.4][L.hands],
    hp: [3, 4, 5, 6][L.grit],          // hits he can take
    regen: [1 / 9, 1 / 8, 1 / 7, 1 / 6][L.grit], // hits earned back per second (after 6 s without being hit)
  };
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
  const base = 60, ko = run.kos * 25, combo = run.maxCombo * 4, perfect = run.perfect * 10, clean = Math.round(run.clean * 2.5);
  const docked = Math.round(run.damage / 40);
  const total = Math.max(40, base + ko + combo + perfect + clean - docked);
  return { base, ko, combo, perfect, clean, docked, total };
}
export function bank(amount, score) { P.points += amount; P.runs++; P.best = Math.max(P.best, score | 0); saveProgress(); }

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
