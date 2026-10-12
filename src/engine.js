// Zombie60 engine — pure game logic, no DOM. Runs in the browser and in node (tools/sim.mjs).
// Content contract: docs/CONTENT_GUIDE.md

export const SAVE_VERSION = 2;
export const CAMPAIGN_DAYS = 30;

export const RES_KEYS = ['Food', 'Water', 'Med', 'Ammo', 'Parts', 'Morale', 'Noise', 'ExploreRisk', 'Defense'];
const RES_CAP = { Morale: 100, Noise: 100, ExploreRisk: 100, Defense: 100 };
export const RES_LABEL = {
  Food: '食物', Water: '飲水', Med: '醫療', Ammo: '彈藥', Parts: '零件',
  Morale: '士氣', Noise: '噪音', ExploreRisk: '探索風險', Defense: '防禦',
};
export const STATUS_LABEL = { Health: '健康', Stress: '壓力', Infection: '感染', Body: '體態', Affection: '好感', Trust: '信任' };
export const STAT_LABEL = { STR: '體力', LOG: '理性', CHA: '社交', COM: '戰鬥' };

export const DIET_OPTIONS = [
  { key: 'none', label: '不分配', food: 0, water: 0, dq: -2 },
  { key: 'water', label: '只喝水', food: 0, water: 1, dq: -1 },
  { key: 'basic', label: '基本', food: 1, water: 1, dq: 0 },
  { key: 'good', label: '豐盛', food: 2, water: 2, dq: 1 },
];

export const STANDARD_START = { Food: 10, Water: 10, Med: 1, Ammo: 2, Parts: 2, Morale: 55, Noise: 0, ExploreRisk: 0, Defense: 15 };
export const SCAVENGE_BASE = { Food: 2, Water: 2, Med: 0, Ammo: 0, Parts: 0, Morale: 50, Noise: 0, ExploreRisk: 0, Defense: 10 };

// Where a heroine left behind during the opening scavenge ends up.
export const MISSING_AT = { liShuang: 'shenkeng_school', songNing: 'jingmei_market', xiaJian: 'shenkeng_oldstreet' };

export function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Data bundle

export function buildData({ world, characters, endings, flavor, contentFiles }) {
  const events = [];
  const quests = [];
  for (const f of contentFiles) {
    const evs = Array.isArray(f) ? f : (f.events || []);
    events.push(...evs);
    quests.push(...(f.quests || []));
  }
  const byId = Object.fromEntries(events.map(e => [e.id, e]));
  const locById = Object.fromEntries(world.locations.map(l => [l.id, l]));
  const adj = Object.fromEntries(world.locations.map(l => [l.id, []]));
  for (const [a, b] of world.edges) { adj[a].push(b); adj[b].push(a); }
  return { world, characters, endings, flavor: flavor || {}, events, quests, byId, locById, adj };
}

// ---------------------------------------------------------------------------
// Game

export class Game {
  constructor(data, { rng = Math.random, state = null } = {}) {
    this.data = data;
    this.rng = rng;
    this.state = state || this.freshState();
    this.listeners = [];
  }

  // --- helpers
  r() { return this.rng(); }
  ri(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
  pick(arr) { return arr.length ? arr[Math.floor(this.r() * arr.length)] : undefined; }
  d6() { return this.ri(1, 6); }
  loc(id) { return this.data.locById[id]; }
  locName(id) { return this.loc(id)?.name || id; }
  char(id) { return this.state.chars[id]; }
  player() { return Object.values(this.state.chars).find(c => c.isPlayer); }
  heroines() { return Object.values(this.state.chars).filter(c => !c.isPlayer); }
  present() { return Object.values(this.state.chars).filter(c => c.alive && c.status === 'home'); }
  presentHeroines() { return this.present().filter(c => !c.isPlayer); }
  displayName(c) { return c.isPlayer ? '你' : c.name; }

  freshState() {
    const { world, characters } = this.data;
    const chars = {};
    for (const c of characters) {
      chars[c.id] = {
        id: c.id, name: c.name, role: c.role, isPlayer: !!c.isPlayer, stats: { ...c.stats },
        Health: 80, Stress: 10, Infection: 0, Body: 50, Affection: 0, Trust: 0,
        alive: true, status: 'home', away: null, missingAt: null,
        todayDiet: 'basic', hunger: 0, thirst: 0,
      };
    }
    const density = {};
    for (const l of world.locations) density[l.id] = l.id === 'home' ? 5 : clamp(l.danger * 10 + 5, 0, 100);
    return {
      version: SAVE_VERSION,
      day: 1,
      phase: 'intro',
      resources: { ...STANDARD_START },
      chars,
      flags: {},
      factions: Object.fromEntries(world.factions.map(f => [f.id, f.startRep || 0])),
      world: {
        weather: 'clear',
        discovered: Object.fromEntries(world.locations.filter(l => l.startDiscovered).map(l => [l.id, true])),
        density,
        hordes: [],
        hordeSeq: 0,
      },
      feed: [],
      radio: null,
      nightLines: [],
      queue: [],
      seen: {},
      plan: { expeditions: {} },
      today: null,
      outcome: null,
      log: [],
      ending: null,
      stats: { expeditions: 0, eventsSeen: 0, hordesRepelled: 0 },
    };
  }

  // --- logging / feed
  log(text, kind = 'info') { this.state.log.unshift({ day: this.state.day, text, kind }); if (this.state.log.length > 300) this.state.log.length = 300; }
  news(text, kind = 'world') { this.state.feed.unshift({ day: this.state.day, text, kind }); if (this.state.feed.length > 60) this.state.feed.length = 60; }
  flavorLine(path, vars = {}) {
    let node = this.data.flavor;
    for (const k of path.split('.')) node = node?.[k];
    if (!Array.isArray(node) || !node.length) return null;
    return this.fill(this.pick(node), vars);
  }
  fill(text, vars = {}) {
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  }

  // ---------------------------------------------------------------------------
  // Opening

  startStandard() {
    this.state.resources = { ...STANDARD_START };
    this.state.flags.hasRadio = this.r() < 0.5 ? true : undefined;
    if (!this.state.flags.hasRadio) delete this.state.flags.hasRadio;
    this.log('你們在最後一刻衝進地下室。手邊的東西不多，但人都在。', 'story');
    this.beginDay();
  }

  // result: { items: [{effects}], rescued: [charIds], lostBag: bool }
  startFromScavenge(result) {
    const s = this.state;
    s.resources = { ...SCAVENGE_BASE };
    for (const item of result.items) this.applyEffects(item.effects || {}, {});
    for (const h of this.heroines()) {
      if (!result.rescued.includes(h.id)) {
        h.status = 'missing';
        h.missingAt = MISSING_AT[h.id];
        h.missingSince = 1;
        s.world.discovered[h.missingAt] = true;
        this.log(`${h.name}沒能趕上。你只來得及看見門外的影子一閃而過。`, 'bad');
      }
    }
    if (result.lostBag) this.log('鐵門落下的瞬間，背包從你肩上滑落——裡面的東西全掉在樓梯上了。', 'bad');
    this.log(`六十秒結束。你們帶下來的一切，就是接下來的全部。`, 'story');
    this.beginDay();
  }

  // ---------------------------------------------------------------------------
  // Day cycle: beginDay → (plan) commitPlan → (event) choose → (outcome) endDay → beginDay

  beginDay() {
    const s = this.state;
    s.today = { eventId: null, ctx: {}, returns: [], reunions: [] };
    s.outcome = null;
    this.worldTick();
    this.dailyRadio();
    this.processReturns();
    this.missingTick();
    this.nightChatter();
    s.phase = 'plan';
    for (const c of this.present()) c.todayDiet = c.todayDiet || 'basic';
    this.emit();
  }

  dietCost() {
    let food = 0, water = 0;
    for (const c of this.present()) {
      const o = DIET_OPTIONS.find(d => d.key === c.todayDiet) || DIET_OPTIONS[2];
      food += o.food; water += o.water;
    }
    return { food, water };
  }

  // Ration person by person: you first, then whoever is closest to collapse.
  autoRation() {
    const s = this.state;
    const home = this.present();
    const n = home.length;
    let food = s.resources.Food, water = s.resources.Water;
    const rich = food >= n * 6 && water >= n * 6;
    const order = [...home].sort((a, b) => (b.isPlayer - a.isPlayer) || (b.thirst - a.thirst) || (a.Health - b.Health));
    for (const c of order) {
      const wantFood = c.hunger >= 1 || food >= n * 2;
      if (rich) { c.todayDiet = 'good'; food -= 2; water -= 2; }
      else if (water >= 1 && food >= 1 && wantFood) { c.todayDiet = 'basic'; food -= 1; water -= 1; }
      else if (water >= 1) { c.todayDiet = 'water'; water -= 1; }
      else c.todayDiet = 'none';
    }
    this.emit();
  }

  // Send `charId` to `locId` today (plan phase). Pass null to cancel.
  setExpedition(charId, locId) {
    const s = this.state;
    if (s.phase !== 'plan') return;
    if (!locId) delete s.plan.expeditions[charId];
    else s.plan.expeditions[charId] = locId;
    this.emit();
  }

  // Spend the evening with one heroine: small, steady relationship growth and a likelier night scene.
  setCompanion(charId) {
    const s = this.state;
    if (s.phase !== 'plan') return;
    s.plan.companion = charId || null;
    this.emit();
  }

  canUseMed(c) { return this.state.resources.Med > 0 && c.alive && c.status === 'home' && (c.Infection > 0 || c.Health < 100); }
  useMed(charId) {
    const c = this.char(charId);
    if (!this.canUseMed(c)) return;
    this.state.resources.Med -= 1;
    const before = c.Infection;
    c.Infection = clamp(c.Infection - 25, 0, 100);
    c.Health = clamp(c.Health + 12, 0, 100);
    this.log(`你替${this.displayName(c)}處理傷口（Med −1，感染 ${before}→${c.Infection}）。`);
    if (!c.isPlayer) this.rel(c, { Trust: 1 });
    this.emit();
  }

  commitPlan() {
    const s = this.state;
    if (s.phase !== 'plan') return { ok: false, reason: '不是計畫階段' };
    const exp = Object.entries(s.plan.expeditions).filter(([cid]) => this.char(cid)?.status === 'home' && this.char(cid)?.alive);
    if (exp.length && exp.length >= this.present().length) return { ok: false, reason: '至少要留一個人守家。' };
    const { food, water } = this.dietCost();
    if (s.resources.Food < food || s.resources.Water < water) {
      return { ok: false, reason: `物資不足：需要食物 ${food}／飲水 ${water}，目前只有 ${s.resources.Food}／${s.resources.Water}。` };
    }
    this.applyDiet();
    for (const [cid, loc] of exp) this.departExpedition(this.char(cid), loc);
    s.plan.expeditions = {};
    const comp = s.plan.companion && this.char(s.plan.companion);
    s.today.companion = null;
    if (comp && !comp.isPlayer && comp.alive && comp.status === 'home' && this.player().status === 'home') {
      s.today.companion = comp.id;
      this.rel(comp, { Affection: 2, Trust: 1 });
      comp.Stress = clamp(comp.Stress - 4, 0, 100);
      this.log(`今晚你打算陪在${comp.name}身邊。`, 'info');
    }
    s.plan.companion = null;
    this.advance();
    return { ok: true };
  }

  applyDiet() {
    const s = this.state;
    const { food, water } = this.dietCost();
    s.resources.Food -= food;
    s.resources.Water -= water;
    let dq = 0;
    for (const c of this.present()) {
      const o = DIET_OPTIONS.find(d => d.key === c.todayDiet) || DIET_OPTIONS[2];
      dq += o.dq;
      c.hunger = o.food > 0 ? 0 : c.hunger + 1;
      c.thirst = o.water > 0 ? 0 : c.thirst + 1;
      c.Body = clamp(c.Body + (o.dq >= 1 ? 2 : o.dq === -1 ? -1 : o.dq <= -2 ? -3 : 0), 0, 100);
      c.Health = clamp(c.Health + (o.dq >= 1 ? 3 : o.dq <= -2 ? -4 : o.dq === -1 ? -1 : 1), 0, 100);
      c.Stress = clamp(c.Stress + (o.dq >= 1 ? -3 : o.dq <= -2 ? 6 : o.dq === -1 ? 2 : -1), 0, 100);
      // Going hungry hurts from day 3, thirst from day 2 — slower than real life, kinder than a spreadsheet.
      if (c.hunger >= 3) c.Health = clamp(c.Health - 3 * (c.hunger - 2), 0, 100);
      if (c.thirst >= 2) c.Health = clamp(c.Health - 5 * (c.thirst - 1), 0, 100);
    }
    s.today.dietQuality = dq;
    this.log(`飲食分配：食物 −${food}、飲水 −${water}（飲食品質 ${dq >= 0 ? '+' : ''}${dq}）。`);
  }

  departExpedition(c, locId) {
    const l = this.loc(locId);
    c.status = 'away';
    c.away = { loc: locId, departDay: this.state.day, returnDay: this.state.day + l.dist };
    this.state.resources.ExploreRisk = clamp(this.state.resources.ExploreRisk + 1 + l.danger, 0, 100);
    this.state.stats.expeditions += 1;
    const line = this.flavorLine('expedition.depart', { actor: this.displayName(c), loc: l.name });
    this.log(line || `${this.displayName(c)}出發前往${l.name}。`, 'expedition');
  }

  processReturns() {
    const s = this.state;
    for (const c of Object.values(s.chars)) {
      if (!c.alive || c.status !== 'away' || c.away.returnDay > s.day) continue;
      const l = this.loc(c.away.loc);
      const w = this.data.world.weather[s.world.weather] || {};
      const dens = s.world.density[l.id] || 0;
      // Danger roll: the expedition member fights the location.
      const threat = l.danger * 2 + Math.floor(dens / 15) + (w.scavenge < 0 ? -w.scavenge : 0);
      const guard = c.stats.STR + c.stats.COM + this.d6() + this.d6();
      const lootMult = guard >= threat + 4 ? 1.6 : guard >= threat ? 1.25 : 0.6;
      const gained = {};
      for (const [k, [a, b]] of Object.entries(l.loot || {})) {
        let n = Math.round((this.ri(a, b) + (w.scavenge > 0 ? 1 : 0)) * lootMult * (dens >= 70 ? 0.6 : 1));
        if (n > 0) { gained[k] = n; s.resources[k] = (s.resources[k] || 0) + n; }
      }
      let injured = false;
      if (guard < threat) {
        injured = true;
        const dmg = this.ri(6, 14) + (threat - guard) * 2;
        c.Health = clamp(c.Health - dmg, 0, 100);
        c.Infection = clamp(c.Infection + this.ri(0, 1) * this.ri(5, 12), 0, 100);
        c.Stress = clamp(c.Stress + 6, 0, 100);
      }
      c.status = 'home';
      const loc = c.away.loc;
      c.away = null;
      if (c.Health <= 0) {
        this.killChar(c, `${this.displayName(c)}沒有從${l.name}回來。`);
        continue;
      }
      const gainTxt = Object.entries(gained).map(([k, v]) => `${RES_LABEL[k]}+${v}`).join('、');
      const vars = { actor: this.displayName(c), loc: l.name };
      const line = (Object.keys(gained).length ? this.flavorLine('expedition.return', vars) : this.flavorLine('expedition.empty', vars))
        || `${vars.actor}從${l.name}回來了。`;
      this.log(`${line}${gainTxt ? `（${gainTxt}）` : ''}`, 'expedition');
      if (injured) this.log(this.flavorLine('expedition.injured', vars) || `${vars.actor}帶著傷回來。`, 'bad');
      s.today.returns.push({ charId: c.id, loc });
      // Reunion with a missing heroine at this location.
      for (const h of this.heroines()) {
        if (h.alive && h.status === 'missing' && h.missingAt === loc) s.today.reunions.push({ heroine: h.id, actor: c.id });
      }
    }
  }

  missingTick() {
    for (const h of this.heroines()) {
      if (!h.alive || h.status !== 'missing') continue;
      h.Health = clamp(h.Health - 2, 0, 100);
      if (this.state.day % 4 === 0) this.news(`有人說在${this.locName(h.missingAt)}附近見過一個像${h.name}的人。`, 'rumor');
      if (h.Health <= 0) this.killChar(h, `關於${h.name}的消息，再也沒有傳來。`);
    }
  }

  nightChatter() {
    const s = this.state;
    s.nightLines = [];
    for (const h of this.presentHeroines()) {
      const line = this.flavorLine(`night.${h.id}`);
      if (line) s.nightLines.push({ id: h.id, name: h.name, text: line });
    }
    const m = s.resources.Morale;
    const mood = m <= 25 ? this.flavorLine('night.lowMorale') : m >= 70 ? this.flavorLine('night.highMorale') : null;
    if (mood) s.nightLines.push({ id: 'all', name: '', text: mood });
  }

  dailyRadio() {
    const s = this.state;
    s.radio = null;
    if (!s.flags.hasRadio) return;
    const pool = (this.data.flavor.radio || []).filter(r =>
      (!r.minDay || s.day >= r.minDay) && (!r.maxDay || s.day <= r.maxDay) && (r.flags || []).every(f => s.flags[f]));
    // Prefer the most "advanced" broadcasts (more flags) when available.
    const maxFlags = Math.max(0, ...pool.map(r => (r.flags || []).length));
    const best = pool.filter(r => (r.flags || []).length === maxFlags);
    const pickFrom = this.r() < 0.7 && best.length ? best : pool;
    const r = this.pick(pickFrom);
    if (r) s.radio = r.text;
  }

  // ---------------------------------------------------------------------------
  // World simulation

  worldTick() {
    const s = this.state;
    const W = this.data.world;
    // Weather (sticky: 45% chance to keep yesterday's).
    if (s.day > 1 && this.r() > 0.45) {
      const entries = Object.entries(W.weather);
      const total = entries.reduce((a, [, w]) => a + w.weight, 0);
      let roll = this.r() * total;
      for (const [id, w] of entries) { roll -= w.weight; if (roll <= 0) { s.world.weather = id; break; } }
    }
    const weather = W.weather[s.world.weather];
    const wl = this.flavorLine(`news.weather_${s.world.weather}`);
    if (wl && this.r() < 0.6) this.news(wl, 'weather');
    if (weather.water > 0 && s.flags.hasRainCollector) {
      s.resources.Water += weather.water + 1;
      this.log(`雨水順著集雨布流進桶子裡（飲水 +${weather.water + 1}）。`, 'good');
    } else if (weather.water > 0) {
      s.resources.Water += 2;
      this.log('你們用鍋子在通風口下接了一點雨水（飲水 +2）。', 'good');
    } else if (weather.water < 0 && s.resources.Water > 6) {
      s.resources.Water = Math.max(0, s.resources.Water + weather.water);
      this.log(`酷熱讓存水蒸發得特別快（飲水 ${weather.water}）。`, 'bad');
    }

    // Density drifts back toward each location's baseline.
    for (const l of W.locations) {
      const base = l.id === 'home' ? 5 + Math.floor(s.resources.Noise / 4) : l.danger * 10 + 5;
      const cur = s.world.density[l.id];
      s.world.density[l.id] = clamp(Math.round(cur + (base - cur) * 0.25 + (this.r() * 6 - 3)), 0, 100);
    }

    // Hordes: spawn, move, dissolve.
    const spawnChance = 0.12 + s.day * 0.012 + (weather.horde || 0) / 100;
    if (s.day > 2 && this.r() < spawnChance && s.world.hordes.length < 3) this.spawnHorde();
    for (const h of [...s.world.hordes]) this.moveHorde(h, weather);

    // Factions go about their business.
    const metMap = { nightmarket: 'metNightmarket', students: 'metStudents', military: 'metMilitary', blackrain: 'metBlackrain' };
    if (this.r() < 0.55) {
      const f = this.pick(W.factions);
      const line = this.flavorLine(`news.faction_${f.id}`);
      if (line) this.news(s.flags[metMap[f.id]] ? `【${f.name}】${line}` : line, 'faction');
    }
    for (const l of W.locations) {
      if (l.id !== 'home' && s.world.discovered[l.id] && s.world.density[l.id] >= 75 && this.r() < 0.25) {
        const line = this.flavorLine('news.density_high', { loc: l.name });
        if (line) this.news(line, 'danger');
      }
    }
    if (!s.feed.length || s.feed[0].day !== s.day) {
      const q = this.flavorLine('news.quiet');
      if (q) this.news(q, 'quiet');
    }
  }

  spawnHorde(at = null, size = null) {
    const s = this.state;
    const far = this.data.world.locations.filter(l => l.id !== 'home' && l.dist >= 2);
    const origin = at || this.pick(far).id;
    const h = {
      id: ++s.world.hordeSeq,
      at: origin,
      size: size || this.ri(25, 45 + s.day),
      target: this.pickHordeTarget(origin),
      linger: 0,
    };
    s.world.hordes.push(h);
    s.world.density[origin] = clamp(s.world.density[origin] + Math.round(h.size / 2), 0, 100);
    const line = this.flavorLine('news.horde_arrive', { loc: this.locName(origin) }) || `${this.locName(origin)}出現了一波屍潮。`;
    this.news(line, 'danger');
    return h;
  }

  pickHordeTarget(from) {
    const s = this.state;
    // Noise and exploration attract hordes toward home.
    const homePull = 0.15 + s.resources.Noise / 120 + s.resources.ExploreRisk / 200;
    if (this.r() < homePull) return 'home';
    const others = this.data.world.locations.filter(l => l.id !== from && l.id !== 'home');
    return this.pick(others).id;
  }

  path(from, to) {
    const { adj } = this.data;
    const prev = { [from]: null };
    const q = [from];
    while (q.length) {
      const n = q.shift();
      if (n === to) break;
      for (const m of adj[n]) if (!(m in prev)) { prev[m] = n; q.push(m); }
    }
    if (!(to in prev)) return [from];
    const out = [];
    for (let n = to; n !== null; n = prev[n]) out.unshift(n);
    return out;
  }

  moveHorde(h, weather) {
    const s = this.state;
    if (h.at === h.target) {
      h.linger += 1;
      h.size -= this.ri(6, 12);
      if (h.at === 'home' && h.linger === 1) this.enqueue('CORE_HORDE', 0, { hordeId: h.id });
      if (h.size <= 8 || h.linger >= 3) {
        s.world.hordes = s.world.hordes.filter(x => x !== h);
        const line = this.flavorLine('news.horde_fade', { loc: this.locName(h.at) });
        if (line) this.news(line, 'world');
      }
      return;
    }
    const slow = (weather.horde || 0) < 0 ? -weather.horde / 30 : 0;
    if (this.r() < 0.25 + slow) return;
    const p = this.path(h.at, h.target);
    if (p.length < 2) { h.target = h.at; return; }
    const from = h.at;
    h.at = p[1];
    s.world.density[h.at] = clamp(s.world.density[h.at] + Math.round(h.size / 3), 0, 100);
    if (h.at === 'home') {
      this.news(this.flavorLine('news.horde_near_home') || '屍潮湧進了你們的巷子。', 'danger');
    } else if (this.data.adj[h.at].includes('home') && h.target === 'home') {
      this.news(this.flavorLine('news.horde_near_home') || `屍潮正從${this.locName(h.at)}往你們這裡來。`, 'danger');
    } else if (s.world.discovered[from] || s.world.discovered[h.at]) {
      const line = this.flavorLine('news.horde_move', { from: this.locName(from), to: this.locName(h.at) });
      if (line) this.news(line, 'danger');
    }
  }

  // ---------------------------------------------------------------------------
  // Conditions

  cmp(v, spec) {
    if (typeof spec === 'number') return v === spec;
    if (typeof spec === 'boolean') return !!v === spec;
    if (!spec || typeof spec !== 'object') return true;
    if (spec.gte !== undefined && !(v >= spec.gte)) return false;
    if (spec.lte !== undefined && !(v <= spec.lte)) return false;
    if (spec.gt !== undefined && !(v > spec.gt)) return false;
    if (spec.lt !== undefined && !(v < spec.lt)) return false;
    if (spec.eq !== undefined && !(v === spec.eq)) return false;
    return true;
  }

  charMatches(c, spec) {
    for (const [k, v] of Object.entries(spec)) {
      if (k === 'alive') { if (!!c.alive !== v) return false; continue; }
      if (k === 'present') { if ((c.alive && c.status === 'home') !== v) return false; continue; }
      if (k === 'missing') { if ((c.alive && c.status === 'missing') !== v) return false; continue; }
      if (!this.cmp(c[k], v)) return false;
    }
    return true;
  }

  // Returns false, or a binding object ({target}) when conditions hold.
  test(cond, ctx = {}) {
    if (!cond) return {};
    const s = this.state;
    if (cond.minDay !== undefined && s.day < cond.minDay) return false;
    if (cond.maxDay !== undefined && s.day > cond.maxDay) return false;
    if (cond.flags && !cond.flags.every(f => s.flags[f])) return false;
    if (cond.notFlags && cond.notFlags.some(f => s.flags[f])) return false;
    if (cond.resources) for (const [k, v] of Object.entries(cond.resources)) if (!this.cmp(s.resources[k] || 0, v)) return false;
    if (cond.chars) for (const [id, spec] of Object.entries(cond.chars)) {
      const c = s.chars[id];
      if (!c || !this.charMatches(c, spec)) return false;
    }
    if (cond.factions) for (const [f, v] of Object.entries(cond.factions)) if (!this.cmp(s.factions[f] || 0, v)) return false;
    if (cond.weather && !cond.weather.includes(s.world.weather)) return false;
    if (cond.density) for (const [l, v] of Object.entries(cond.density)) if (!this.cmp(s.world.density[l] || 0, v)) return false;
    let target = ctx.target;
    if (cond.anyChar) {
      const pool = this.presentHeroines().filter(c => this.charMatches(c, cond.anyChar));
      if (!pool.length) return false;
      target = target && pool.find(c => c.id === target) ? target : this.pick(pool).id;
    }
    if (cond.chance !== undefined && this.r() >= cond.chance) return false;
    return { target };
  }

  // ---------------------------------------------------------------------------
  // Events

  enqueue(id, inDays, ctx = {}) {
    this.state.queue.push({ id, day: this.state.day + inDays, ctx, added: this.state.day });
  }

  eligible(pool, ctx = {}) {
    const s = this.state;
    const out = [];
    for (const e of this.data.events) {
      if (e.pool !== pool) continue;
      const seen = s.seen[e.id];
      if (e.once && seen !== undefined) continue;
      if (!e.once && seen !== undefined && s.day - seen < 6) continue;
      const b = this.test(e.conditions, ctx);
      if (b) out.push({ e, bind: b });
    }
    return out;
  }

  weighted(list) {
    const total = list.reduce((a, x) => a + (x.e.weight ?? 10), 0);
    let roll = this.r() * total;
    for (const x of list) { roll -= (x.e.weight ?? 10); if (roll <= 0) return x; }
    return list[list.length - 1];
  }

  // Morning: someone came back. Reunions first, then a location encounter.
  drawReturnScene() {
    const today = this.state.today;
    if (today.reunions.length) {
      const r = today.reunions.shift();
      return this.setEvent(this.reunionEvent(r.heroine, r.actor), { actor: r.actor, target: r.heroine });
    }
    for (const ret of today.returns) {
      if (!this.char(ret.charId)?.alive) continue;
      const list = this.eligible(`loc:${ret.loc}`, { actor: ret.charId });
      // Unique encounters (quest beats, first contact) always play; routine scavenging only sometimes does.
      const unique = list.filter(x => x.e.once);
      const pool = unique.length ? unique : this.r() < 0.6 ? list : [];
      if (pool.length) { const x = this.weighted(pool); return this.setEvent(x.e, { ...x.bind, actor: ret.charId }); }
    }
    return null;
  }

  // Daytime: queued chains, then story beats, then something from home or the wider world.
  drawEvent() {
    const s = this.state;
    let chosen = null;

    // Nobody home (everyone out or gone): the day passes in an empty basement.
    if (!this.present().length) return this.setEvent(this.emptyShelterEvent(), {});
    // 1) Queued (chains, horde assault). Stale entries expire after 4 days.
    s.queue = s.queue.filter(q => s.day - q.day <= 4 && this.data.byId[q.id]);
    const due = s.queue.filter(q => q.day <= s.day).sort((a, b) => (a.id === 'CORE_HORDE' ? -1 : 0) - (b.id === 'CORE_HORDE' ? -1 : 0));
    for (const q of due) {
      const e = this.data.byId[q.id];
      const b = this.test(e.conditions, q.ctx);
      if (b) { s.queue = s.queue.filter(x => x !== q); chosen = { e, bind: { ...q.ctx, ...b } }; break; }
    }
    // 2) Story beats fire as soon as their conditions hold.
    if (!chosen) {
      const st = this.eligible('story');
      if (st.length) chosen = st[0];
    }
    // 3) Random daily event. Romance mostly lives in the night scene; daytime only falls back to it.
    if (!chosen) {
      const order = this.r() < 0.45 ? ['world', 'shelter', 'romance'] : ['shelter', 'world', 'romance'];
      for (const p of order) {
        const list = this.eligible(p);
        if (list.length) { chosen = this.weighted(list); break; }
      }
    }
    if (!chosen) return this.setEvent(this.quietEvent(), {});
    return this.setEvent(chosen.e, chosen.bind || {});
  }

  // Scene order within a day: return (morning) → day → night → nightfall.
  advance() {
    const s = this.state;
    const t = s.today;
    if (s.ending) { s.phase = 'ended'; return this.emit(); }
    if (!t.stage) {
      t.stage = 'return';
      if (this.drawReturnScene()) return this.emit();
    }
    if (t.stage === 'return') {
      t.stage = 'day';
      this.drawEvent();
      return this.emit();
    }
    if (t.stage === 'day') {
      t.stage = 'night';
      if (this.drawNightScene()) return this.emit();
    }
    this.nightfall();
  }

  // Evening: a chance for one relationship scene after the day's event.
  drawNightScene() {
    const s = this.state;
    if (this.player().status !== 'home') return null;
    const list = this.eligible('romance');
    if (!list.length) return null;
    const comp = s.today.companion;
    if (this.r() >= (comp ? 0.85 : 0.5)) return null;
    const boosted = list.map(x => ({ ...x, e: x.e, w: (x.e.weight ?? 10) * (comp && x.e.conditions?.chars?.[comp] ? 5 : 1) }));
    const total = boosted.reduce((a, x) => a + x.w, 0);
    let roll = this.r() * total;
    let pick = boosted[boosted.length - 1];
    for (const x of boosted) { roll -= x.w; if (roll <= 0) { pick = x; break; } }
    return this.setEvent(pick.e, pick.bind || {});
  }

  setEvent(e, bind) {
    const s = this.state;
    s.today.eventId = e.id;
    s.today.synthetic = e.synthetic ? e : null;
    s.today.ctx = { actor: bind.actor || null, target: bind.target || null, hordeId: bind.hordeId || null };
    if (!e.synthetic) { s.seen[e.id] = s.day; s.stats.eventsSeen += 1; }
    s.phase = 'event';
    return e;
  }

  currentEvent() {
    const t = this.state.today;
    if (!t || !t.eventId) return null;
    return t.synthetic || this.data.byId[t.eventId] || null;
  }

  textVars() {
    const ctx = this.state.today?.ctx || {};
    const a = ctx.actor && this.char(ctx.actor);
    const t = ctx.target && this.char(ctx.target);
    return { actor: a ? this.displayName(a) : '你', target: t ? t.name : '她' };
  }

  // Resolve who rolls a check.
  checker(check) {
    const ctx = this.state.today?.ctx || {};
    if (check.who === 'actor') {
      if (ctx.actor && this.char(ctx.actor)?.alive) return this.char(ctx.actor);
      return this.checker({ ...check, who: 'best' });
    }
    if (check.who === 'best') {
      const pool = this.present();
      return pool.sort((a, b) => b.stats[check.stat] - a.stats[check.stat])[0] || null;
    }
    const c = this.char(check.who);
    if (c && c.alive && (c.status === 'home' || c.id === ctx.actor)) return c;
    return null;
  }

  // Why a choice is unavailable (string) or null.
  choiceBlock(ch) {
    if (ch.requires && !this.test({ ...ch.requires, chance: undefined }, this.state.today?.ctx)) return this.describeReq(ch.requires);
    if (ch.cost) for (const [k, v] of Object.entries(ch.cost)) {
      if (v > 0 && ['Food', 'Water', 'Med', 'Ammo', 'Parts'].includes(k) && (this.state.resources[k] || 0) < v) return `${RES_LABEL[k]}不足`;
    }
    if (ch.check && !this.checker(ch.check)) {
      const c = this.char(ch.check.who);
      return c ? `${c.name}不在` : '沒有人能做';
    }
    return null;
  }

  describeReq(req) {
    const parts = [];
    for (const [k, v] of Object.entries(req.resources || {})) if (typeof v === 'object' && v.gte !== undefined) parts.push(`需要${RES_LABEL[k]} ${v.gte}`);
    for (const [id, spec] of Object.entries(req.chars || {})) if (spec.present) parts.push(`${this.char(id)?.name || id}需在場`);
    if (req.flags) parts.push('條件未達成');
    return parts.join('、') || '條件未達成';
  }

  checkChance(check) {
    const c = this.checker(check);
    if (!c) return 0;
    const bonus = (this.state.resources.Morale >= 70 ? 1 : 0) - (c.Stress >= 70 ? 1 : 0);
    const need = check.dc - c.stats[check.stat] - bonus; // need d6 >= need
    return clamp((7 - need) / 6, 0, 1);
  }

  // Shown when every authored choice is locked, so an event can never soft-lock the day.
  static HELPLESS = {
    label: '什麼都做不了',
    outcomes: { always: { text: '你們手上什麼都沒有，只能眼睜睜看著事情發生。\n無力感比飢餓更難吞下去。', effects: { status: { Stress: 5 }, resources: { Morale: -4 } } } },
  };

  allBlocked(e) { return e.choices.every(ch => this.choiceBlock(ch)); }

  choose(index) {
    const s = this.state;
    const e = this.currentEvent();
    if (!e || s.phase !== 'event') return;
    const ch = index === -1 && this.allBlocked(e) ? Game.HELPLESS : e.choices[index];
    if (!ch || this.choiceBlock(ch)) return;
    const before = this.snapshot();
    const ctx = s.today.ctx;

    if (ch.cost) for (const [k, v] of Object.entries(ch.cost)) s.resources[k] = (s.resources[k] || 0) - v;

    let checkInfo = null;
    let branch = 'always';
    if (ch.check) {
      const c = this.checker(ch.check);
      const bonus = (s.resources.Morale >= 70 ? 1 : 0) - (c.Stress >= 70 ? 1 : 0);
      const die = this.d6();
      const total = c.stats[ch.check.stat] + die + bonus;
      const ok = total >= ch.check.dc;
      branch = ok ? 'success' : 'fail';
      checkInfo = { who: this.displayName(c), stat: ch.check.stat, die, total, dc: ch.check.dc, ok };
      if (!ctx.actor && ch.check.who !== 'best') ctx.actor = c.id;
    }
    const texts = [];
    for (const key of [branch, branch !== 'always' ? 'always' : null]) {
      const out = key && ch.outcomes?.[key];
      if (!out) continue;
      if (out.text) texts.push(this.fill(out.text, this.textVars()));
      if (out.effects) this.applyEffects(out.effects, ctx);
    }
    if (e.id === 'CORE_HORDE') {
      // Whatever the choice, the wave breaks on the shelter and moves on.
      s.world.hordes = s.world.hordes.filter(h => h.id !== ctx.hordeId && h.at !== 'home');
      if (branch !== 'fail') s.stats.hordesRepelled += 1;
    }
    this.normalize();
    const deltas = this.diff(before, this.snapshot());
    s.outcome = { title: e.title, label: ch.label, texts, check: checkInfo, deltas };
    for (const t of texts) this.log(t, 'story');
    s.phase = s.ending ? 'ended' : 'outcome';
    this.checkDeaths();
    if (!this.player().alive && !s.ending) this.finish('ending_dead');
    this.emit();
  }

  rel(c, d) {
    for (const [k, v] of Object.entries(d)) c[k] = clamp((c[k] || 0) + v, -100, 100);
  }

  resolveId(id, ctx) {
    if (id === '$actor') return ctx.actor || this.player().id;
    if (id === '$target') return ctx.target;
    return id;
  }

  applyEffects(fx, ctx = {}) {
    const s = this.state;
    for (const [k, v] of Object.entries(fx.resources || {})) s.resources[k] = (s.resources[k] || 0) + v;
    for (const c of this.present()) for (const [k, v] of Object.entries(fx.status || {})) c[k] = clamp((c[k] || 0) + v, 0, 100);
    for (const [rawId, d] of Object.entries(fx.chars || {})) {
      const c = s.chars[this.resolveId(rawId, ctx)];
      if (!c || !c.alive) continue;
      for (const [k, v] of Object.entries(d)) c[k] = clamp((c[k] || 0) + v, 0, 100);
    }
    for (const [rawId, d] of Object.entries(fx.relations || {})) {
      const c = s.chars[this.resolveId(rawId, ctx)];
      if (!c || !c.alive || c.isPlayer) continue;
      this.rel(c, d);
    }
    for (const [f, v] of Object.entries(fx.factions || {})) s.factions[f] = clamp((s.factions[f] || 0) + v, -100, 100);
    for (const f of fx.flagsSet || []) s.flags[f] = true;
    for (const f of fx.flagsClear || []) delete s.flags[f];
    for (const l of fx.discover || []) {
      if (!s.world.discovered[l] && this.loc(l)) {
        s.world.discovered[l] = true;
        this.news(`地圖上多了一個地點：${this.locName(l)}。`, 'discover');
      }
    }
    for (const q of fx.queue || []) this.enqueue(q.id, q.inDays, { actor: ctx.actor, target: ctx.target });
    if (fx.world) {
      for (const [l, v] of Object.entries(fx.world.density || {})) s.world.density[l] = clamp((s.world.density[l] || 0) + v, 0, 100);
      if (fx.world.horde) this.spawnHorde(fx.world.horde.at, fx.world.horde.size);
    }
    for (const id of fx.kill || []) { const c = s.chars[this.resolveId(id, ctx)]; if (c?.alive) this.killChar(c, `【死亡】${c.name}倒下了。`); }
    for (const id of fx.rescue || []) {
      const c = s.chars[this.resolveId(id, ctx)];
      if (c?.alive && c.status === 'missing') { c.status = 'home'; c.missingAt = null; this.log(`${c.name}回到了地下室。`, 'good'); }
    }
    if (fx.end) this.finish(fx.end);
  }

  normalize() {
    const r = this.state.resources;
    for (const k of RES_KEYS) r[k] = clamp(Math.round(r[k] || 0), 0, RES_CAP[k] ?? 999);
  }

  snapshot() {
    const s = this.state;
    return {
      resources: { ...s.resources },
      chars: Object.fromEntries(Object.values(s.chars).map(c => [c.id, { Health: c.Health, Stress: c.Stress, Infection: c.Infection, Body: c.Body, Affection: c.Affection, Trust: c.Trust, alive: c.alive }])),
      factions: { ...s.factions },
    };
  }

  diff(a, b) {
    const out = [];
    for (const k of RES_KEYS) { const d = b.resources[k] - a.resources[k]; if (d) out.push({ label: RES_LABEL[k], d, key: k }); }
    for (const id of Object.keys(b.chars)) {
      const c = this.char(id);
      for (const k of ['Health', 'Stress', 'Infection', 'Affection', 'Trust', 'Body']) {
        const d = b.chars[id][k] - a.chars[id][k];
        if (d) out.push({ label: `${this.displayName(c)}・${STATUS_LABEL[k]}`, d, key: k });
      }
    }
    for (const f of Object.keys(b.factions)) {
      const d = b.factions[f] - a.factions[f];
      if (d) out.push({ label: this.data.world.factions.find(x => x.id === f)?.name || f, d, key: 'faction' });
    }
    return out;
  }

  killChar(c, text) {
    if (!c.alive) return;
    c.alive = false;
    c.status = 'dead';
    this.log(text, 'death');
    this.news(text, 'death');
    this.state.resources.Morale = clamp(this.state.resources.Morale - 15, 0, 100);
    for (const h of this.heroines()) if (h.alive && h !== c) h.Stress = clamp(h.Stress + 15, 0, 100);
  }

  checkDeaths() {
    for (const c of Object.values(this.state.chars)) {
      if (!c.alive || c.status === 'missing') continue;
      if (c.Health <= 0) this.killChar(c, `【死亡】${this.displayName(c)}沒能撐過去。`);
      else if (c.Infection >= 100) this.killChar(c, `【死亡】${this.displayName(c)}的眼睛在凌晨失去了焦距。感染贏了。`);
    }
  }

  // ---------------------------------------------------------------------------
  // Synthetic events

  reunionEvent(heroineId, actorId) {
    const h = this.char(heroineId);
    const src = this.data.characters.find(c => c.id === heroineId);
    const days = this.state.day - (h.missingSince || 1);
    const actor = this.char(actorId);
    const intro = actor.isPlayer ? '' : `${actor.name}回來的時候，身後多了一個人。\n\n`;
    return {
      id: `REUNION_${heroineId}`,
      synthetic: true,
      title: `重逢：${h.name}`,
      text: intro + this.fill(src.reunion || `${h.name}還活著。`, { days }),
      choices: [
        { label: `把${h.name}帶回家`, outcomes: { always: { text: `${h.name}回到了地下室。`, effects: { rescue: [heroineId], relations: { [heroineId]: { Affection: 8, Trust: 10 } }, resources: { Morale: 10 } } } } },
        { label: '先讓她休息、處理傷口（Med −1）', requires: { resources: { Med: { gte: 1 } } }, cost: { Med: 1 }, outcomes: { always: { text: `你替${h.name}包紮。她沒說謝謝，只是一直盯著你的手看。`, effects: { rescue: [heroineId], chars: { [heroineId]: { Health: 20 } }, relations: { [heroineId]: { Affection: 12, Trust: 12 } }, resources: { Morale: 10 } } } } },
      ],
    };
  }

  emptyShelterEvent() {
    return {
      id: 'EMPTY',
      synthetic: true,
      title: '空無一人的地下室',
      text: '鐵門後面沒有人。只有滴水聲，和一盞忘了關的小燈。\n地下室在等它的人回來。',
      choices: [
        { label: '（等待）', outcomes: { always: { text: '一天過去了。', effects: {} } } },
        { label: '（等待更久一點）', outcomes: { always: { text: '牆外有什麼東西停了一下，又走了。', effects: { resources: { Noise: -2 } } } } },
      ],
    };
  }

  quietEvent() {
    return {
      id: 'QUIET',
      synthetic: true,
      title: '平靜的一天',
      text: '沒有人敲門，沒有人吵架，牆外也只有風聲。\n平靜在末日裡是一種奢侈，也是一種讓人坐立難安的空白。',
      choices: [
        { label: '讓大家好好休息', outcomes: { always: { text: '你們難得睡了一個長覺。', effects: { status: { Stress: -5, Health: 2 } } } } },
        { label: '整理據點、加固門窗（零件 −1）', requires: { resources: { Parts: { gte: 1 } } }, cost: { Parts: 1 }, outcomes: { always: { text: '你們把鐵門的鉸鍊重新上油，又在樓梯口堆了一排沙包。', effects: { resources: { Defense: 6 }, status: { Stress: 2 } } } } },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Night: pressure check, upkeep, deaths, endings

  // Continue after an outcome: next scene of the day, or nightfall.
  endDay() {
    if (this.state.phase !== 'outcome') return;
    this.advance();
  }

  nightfall() {
    const s = this.state;
    this.zombiePressureCheck();
    this.upkeep();
    this.checkDeaths();
    this.normalize();
    if (!this.player().alive) return this.finish('ending_dead');
    if (s.ending) return this.emit();
    if (s.day >= CAMPAIGN_DAYS) return this.finish(this.judgeEnding());
    s.day += 1;
    this.beginDay();
  }

  zombiePressureCheck() {
    const s = this.state;
    const r = s.resources;
    const defenders = this.present().sort((a, b) => b.stats.COM - a.stats.COM);
    const best = defenders[0];
    if (!best) return;
    const difficulty = 28 + r.Noise * 0.6 + r.ExploreRisk * 0.5 + s.world.density.home * 0.4 + s.day * 0.9 - r.Defense * 0.45;
    const roll = this.r() * 100 + best.stats.COM * 5 + (r.Ammo > 0 ? 6 : 0);
    if (roll >= difficulty) {
      r.Morale = clamp(r.Morale + 1, 0, 100);
      if (r.Ammo > 0 && difficulty > 60 && this.r() < 0.5) { r.Ammo -= 1; this.log(`夜裡有東西撞門。${this.displayName(best)}守住了（彈藥 −1）。`); }
    } else {
      const margin = difficulty - roll;
      const victim = this.pick(this.present());
      const dmg = Math.round(6 + margin / 5);
      victim.Health = clamp(victim.Health - dmg, 0, 100);
      victim.Infection = clamp(victim.Infection + this.ri(4, 10), 0, 100);
      r.Defense = clamp(r.Defense - this.ri(3, 7), 0, 100);
      r.Morale = clamp(r.Morale - 5, 0, 100);
      if (r.Water > 0 && this.r() < 0.5) r.Water -= 1;
      this.log(`深夜，牆外的抓撓聲變成了撞擊。${this.displayName(victim)}在堵門時受傷（健康 −${dmg}，防禦下降）。`, 'bad');
    }
    r.ExploreRisk = clamp(r.ExploreRisk - 2, 0, 100);
    r.Noise = clamp(r.Noise - 1, 0, 100);
  }

  upkeep() {
    const s = this.state;
    const m = s.resources.Morale;
    for (const c of Object.values(s.chars)) {
      if (!c.alive || c.status === 'missing') continue;
      if (c.Infection > 0) {
        c.Infection = clamp(c.Infection + (c.Infection >= 40 ? 3 : 1), 0, 100);
        if (c.Infection >= 50) c.Health = clamp(c.Health - 3, 0, 100);
      }
      if (c.status === 'home') {
        if (m <= 20) c.Stress = clamp(c.Stress + 3, 0, 100);
        else if (m >= 70) c.Stress = clamp(c.Stress - 2, 0, 100);
        if (c.Stress >= 85) s.resources.Morale = clamp(s.resources.Morale - 2, 0, 100);
      }
    }
    // Morale slowly reflects the group's stress.
    const home = this.present();
    if (home.length) {
      const avgStress = home.reduce((a, c) => a + c.Stress, 0) / home.length;
      s.resources.Morale = clamp(Math.round(s.resources.Morale + (avgStress < 30 ? 1 : avgStress > 60 ? -2 : 0)), 0, 100);
    }
  }

  judgeEnding() {
    const alive = this.heroines().filter(h => h.alive && h.status !== 'missing');
    if (!alive.length) return 'ending_alone';
    const bonded = alive.filter(h => this.state.flags[`ro_${{ liShuang: 'ls', songNing: 'sn', xiaJian: 'xj' }[h.id]}_bond`]);
    if (alive.length === 3 && bonded.length === 3 && alive.every(h => h.Affection >= 50 && h.Trust >= 25)) return 'ending_harem';
    const best = [...alive].sort((a, b) => b.Affection - a.Affection)[0];
    if (best.Affection >= 55 && bonded.includes(best)) return `ending_${best.id}`;
    return 'ending_survive';
  }

  finish(endingId) {
    const s = this.state;
    if (s.ending) return;
    const e = this.data.endings.find(x => x.id === endingId) || this.data.endings.find(x => x.id === 'ending_survive');
    s.ending = { id: e.id, title: e.title, kind: e.kind, text: e.text, day: s.day };
    s.phase = 'ended';
    this.log(`【結局】${e.title}`, 'story');
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Quest journal

  questProgress() {
    const s = this.state;
    return this.data.quests.map(q => {
      let reached = -1;
      q.stages.forEach((st, i) => { if (s.flags[st.flag]) reached = i; });
      return { id: q.id, title: q.title, summary: q.summary, reached, stages: q.stages, done: reached === q.stages.length - 1 };
    }).filter(q => q.reached >= 0);
  }

  // ---------------------------------------------------------------------------
  // Save / load / events

  onChange(fn) { this.listeners.push(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
  serialize() { return JSON.stringify(this.state); }
  static deserialize(data, raw, opts = {}) {
    const st = JSON.parse(raw);
    if (st.version !== SAVE_VERSION) throw new Error('存檔版本不相容（舊版原型存檔）');
    return new Game(data, { ...opts, state: st });
  }
}
