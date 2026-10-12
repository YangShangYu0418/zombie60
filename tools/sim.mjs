#!/usr/bin/env node
// Headless balance simulation: plays N full games with a simple heuristic policy.
// Usage: node tools/sim.mjs [games=500] [--seed=1] [--scavenge] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game, buildData, mulberry32 } from '../src/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', p), 'utf8'));
const manifest = read('manifest.json');
const data = buildData({
  world: read('world.json'),
  characters: read('characters.json'),
  endings: read('endings.json'),
  flavor: read(manifest.flavor),
  contentFiles: manifest.content.map(read),
});

const args = process.argv.slice(2);
const N = Number(args.find(a => /^\d+$/.test(a)) || 500);
const seed0 = Number((args.find(a => a.startsWith('--seed=')) || '--seed=1').split('=')[1]);
const scavenge = args.includes('--scavenge');
const verbose = args.includes('--verbose');

function policy(g, rng, fav) {
  const s = g.state;
  const home = g.present();
  if (fav && g.char(fav).alive && g.char(fav).status === 'home') g.setCompanion(fav);
  // Diet: basic if we can afford it for everyone, otherwise water-only, otherwise nothing.
  const n = home.length;
  g.autoRation();
  // Meds for the badly infected.
  for (const c of home) if (c.Infection >= 35 && s.resources.Med > 0) g.useMed(c.id);
  // Expedition: send the sturdiest healthy non-player when supplies run low, or to rescue someone.
  const missing = g.heroines().find(h => h.alive && h.status === 'missing');
  const low = s.resources.Food < n * 3 || s.resources.Water < n * 3;
  if ((low || missing || rng() < 0.35) && home.length >= 2) {
    const runner = [...home].filter(c => c.Health >= 45 && c.id !== fav).sort((a, b) => (a.isPlayer - b.isPlayer) || (b.stats.STR + b.stats.COM) - (a.stats.STR + a.stats.COM))[0];
    if (runner) {
      const locs = data.world.locations.filter(l => l.id !== 'home' && s.world.discovered[l.id]);
      let target = missing && s.world.discovered[missing.missingAt] ? missing.missingAt : null;
      // Follow the quest journal: go where a unique encounter is waiting.
      if (!target && rng() < 0.6) {
        const leads = locs.filter(l => g.eligible(`loc:${l.id}`, { actor: runner.id }).some(x => x.e.once));
        if (leads.length) target = leads[Math.floor(rng() * leads.length)].id;
      }
      if (!target) {
        const want = s.resources.Water < s.resources.Food ? 'Water' : 'Food';
        const opts = locs.filter(l => l.loot[want] && s.world.density[l.id] < 70);
        target = (opts.length ? opts : locs)[Math.floor(rng() * (opts.length ? opts : locs).length)]?.id;
        if (rng() < 0.4) target = locs[Math.floor(rng() * locs.length)].id; // curiosity drives quests
      }
      if (target) g.setExpedition(runner.id, target);
    }
  }
  let res = g.commitPlan();
  if (!res.ok) {
    for (const c of home) c.todayDiet = 'none';
    g.state.plan.expeditions = {};
    res = g.commitPlan();
  }
  return res;
}

function chooseOption(g, rng, fav) {
  const e = g.currentEvent();
  const open = e.choices.map((c, i) => [c, i]).filter(([c]) => !g.choiceBlock(c));
  if (!open.length) { if (!g.allBlocked(e)) throw new Error(`event ${e.id}: no available choice`); return g.choose(-1); }
  // Prefer quest-advancing/ending choices a bit, otherwise random.
  const scored = open.map(([c, i]) => {
    const fx = JSON.stringify(c.outcomes);
    let w = 1 + rng();
    if (/flagsSet/.test(fx)) w += 0.5;
    if (/"end"/.test(fx)) w += 0.3;
    if (fav && new RegExp(`"${fav}":\\{"Affection":[1-9]`).test(fx)) w += 1.2;
    return [w, i];
  }).sort((a, b) => b[0] - a[0]);
  g.choose(scored[0][1]);
}

const endings = {};
const causes = {};
const favStats = { n: 0, aff: 0, trust: 0, maxAff: 0, stages: {} };
const deathsByDay = {};
const fired = {};
const problems = [];
let starvation = 0, totalDays = 0, hordes = 0, maxHordes = 0;
const heroineSurvival = { liShuang: 0, songNing: 0, xiaJian: 0 };
const questsDone = {};
const flagHits = {};

for (let i = 0; i < N; i++) {
  const rng = mulberry32(seed0 + i * 7919);
  const g = new Game(data, { rng });
  const fav = rng() < 0.75 ? ['liShuang', 'songNing', 'xiaJian'][i % 3] : null;
  if (scavenge) {
    const rescued = ['liShuang', 'songNing', 'xiaJian'].filter(() => rng() < 0.7);
    const items = [{ effects: { resources: { Food: 6, Water: 6, Med: 1, Ammo: 2, Parts: 2 } } }];
    if (rng() < 0.5) items.push({ effects: { flagsSet: ['hasRadio'] } });
    g.startFromScavenge({ items, rescued, lostBag: false });
  } else g.startStandard();
  let guard = 0;
  while (g.state.phase !== 'ended' && guard++ < 400) {
    const ph = g.state.phase;
    try {
      if (ph === 'plan') policy(g, rng, fav);
      else if (ph === 'event') {
        const e = g.currentEvent();
        fired[e.id] = (fired[e.id] || 0) + 1;
        const txt = g.fill(e.text, g.textVars());
        if (/\{\w+\}/.test(txt)) problems.push(`${e.id}: unresolved placeholder in text`);
        chooseOption(g, rng, fav);
      } else if (ph === 'outcome') {
        for (const t of g.state.outcome.texts) if (/\{\w+\}/.test(t)) problems.push(`${g.state.today.eventId}: unresolved placeholder in outcome`);
        g.endDay();
      } else throw new Error(`stuck in phase ${ph}`);
    } catch (err) {
      problems.push(`game ${i} day ${g.state.day}: ${err.stack.split('\n').slice(0, 2).join(' ')}`);
      break;
    }
    maxHordes = Math.max(maxHordes, g.state.world.hordes.length);
  }
  const s = g.state;
  const end = s.ending?.id || 'unfinished';
  endings[end] = (endings[end] || 0) + 1;
  if (end === 'ending_dead') {
    deathsByDay[s.day] = (deathsByDay[s.day] || 0) + 1;
    const p = g.player();
    const cause = p.Infection >= 100 ? 'infection' : p.thirst >= 2 ? 'thirst' : p.hunger >= 3 ? 'hunger' : 'injury';
    causes[cause] = (causes[cause] || 0) + 1;
  }
  if (s.log.some(l => /沒能撐過去/.test(l.text))) starvation++;
  totalDays += s.day;
  hordes += s.stats.hordesRepelled;
  for (const h of Object.keys(heroineSurvival)) if (s.chars[h].alive) heroineSurvival[h]++;
  if (fav && s.chars[fav].alive) { favStats.n++; favStats.aff += s.chars[fav].Affection; favStats.trust += s.chars[fav].Trust; favStats.maxAff = Math.max(favStats.maxAff, s.chars[fav].Affection);
    const stage = [1, 2, 3, 4, 5, 6].filter(k => s.flags[`ro_${{ liShuang: 'ls', songNing: 'sn', xiaJian: 'xj' }[fav]}_${k}`]).length; favStats.stages[stage] = (favStats.stages[stage] || 0) + 1; }
  for (const f of Object.keys(s.flags)) if (/^q[nrh]_/.test(f)) flagHits[f] = (flagHits[f] || 0) + 1;
  for (const q of g.questProgress()) if (q.done) questsDone[q.id] = (questsDone[q.id] || 0) + 1;
  if (process.env.DEBUG_FAV && fav === process.env.DEBUG_FAV && end === 'ending_survive') console.log('DBG', g.heroines().map(h => `${h.id} A${h.Affection} T${h.Trust} ${h.status}`).join(' | '), Object.keys(s.flags).filter(f => f.startsWith('ro_xj')).join(','));
  if (verbose || end === 'unfinished') console.log('#', i, fav, end, 'day', s.day, 'phase', s.phase, 'event', s.today?.eventId, 'guard', guard);
}

const pct = (n) => `${((n / N) * 100).toFixed(1)}%`;
console.log(`\n=== ${N} games (${scavenge ? 'scavenge start' : 'standard start'}) ===`);
console.log('Endings:');
for (const [k, v] of Object.entries(endings).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${String(v).padStart(5)}  ${pct(v)}`);
console.log(`Player death causes: ${JSON.stringify(causes)}`);
console.log(`Favourite heroine (alive at end): avg Affection ${(favStats.aff / favStats.n).toFixed(1)}, Trust ${(favStats.trust / favStats.n).toFixed(1)}, max ${favStats.maxAff}; romance stages reached ${JSON.stringify(favStats.stages)}`);
console.log(`Avg final day: ${(totalDays / N).toFixed(1)}`);
console.log(`Death days (player): ${Object.entries(deathsByDay).sort((a, b) => a[0] - b[0]).map(([d, n]) => `D${d}:${n}`).join(' ')}`);
console.log(`Games with a starvation/injury death: ${pct(starvation)}`);
console.log(`Heroine survival: ${Object.entries(heroineSurvival).map(([k, v]) => `${k} ${pct(v)}`).join('  ')}`);
console.log(`Quests completed: ${Object.entries(questsDone).map(([k, v]) => `${k} ${pct(v)}`).join('  ') || 'none'}`);
if (args.includes('--flags')) console.log('Quest flags:', Object.entries(flagHits).sort().map(([k, v]) => `${k}:${v}`).join(' '));
console.log(`Hordes repelled per game: ${(hordes / N).toFixed(2)}  (max concurrent hordes ${maxHordes})`);
const byPool = {};
for (const [id, n] of Object.entries(fired)) { const e = data.byId[id]; const k = e ? (e.pool.startsWith('loc:') ? 'loc' : e.pool) : id; byPool[k] = (byPool[k] || 0) + n; }
console.log('Events per game by pool:', Object.entries(byPool).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / N).toFixed(1)}`).join('  '));
const never = data.events.filter(e => !fired[e.id]).map(e => e.id);
console.log(`Events fired: ${data.events.length - never.length}/${data.events.length}`);
if (never.length) console.log(`Never fired: ${never.join(' ')}`);
const uniq = [...new Set(problems)];
if (uniq.length) { console.log(`\nPROBLEMS (${problems.length}):`); for (const p of uniq.slice(0, 30)) console.log('  ' + p); }
process.exit(uniq.some(p => /game \d+/.test(p)) ? 1 : 0);
