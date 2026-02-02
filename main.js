const SAVE_KEY = 'zombie60.save.v1';

const CHARACTERS = [
  { id: 'shenYan', name: '沈硯', role: '隊長', stats: { STR: 3, LOG: 3, CHA: 2, COM: 2 } },
  { id: 'liShuang', name: '黎霜', role: '理性/修理', stats: { STR: 2, LOG: 5, CHA: 1, COM: 2 } },
  { id: 'songNing', name: '宋寧', role: '社交/談判', stats: { STR: 2, LOG: 2, CHA: 5, COM: 1 } },
  { id: 'xiaJian', name: '夏見', role: '行動/守家', stats: { STR: 4, LOG: 1, CHA: 1, COM: 5 } },
];

const DIET_OPTIONS = [
  { key: 'none', label: '不分配', food: 0, water: 0, dq: -2 },
  { key: 'poor', label: '糟（半份/不均）', food: 1, water: 1, dq: -1 },
  { key: 'basic', label: '基本（剛好）', food: 1, water: 1, dq: 0 },
  { key: 'good', label: '好（營養/額外）', food: 2, water: 2, dq: 1 },
];

function freshState() {
  return {
    day: 1,
    resources: { Food: 6, Water: 6, Med: 1, Ammo: 1, Morale: 50, Noise: 0, ExploreRisk: 0 },
    chars: Object.fromEntries(CHARACTERS.map(c => [c.id, {
      id: c.id,
      name: c.name,
      role: c.role,
      stats: c.stats,
      Health: 80,
      Stress: 10,
      Infection: 0,
      Body: 50,
      Affection: 0,
      Trust: 0,
      alive: true,
      todayDiet: 'basic'
    }])),
    flags: {},
    log: [],
    lastEventId: null,
    dayDietQuality: 0,
    dayDietCost: { Food: 0, Water: 0 }
  };
}

let EVENTS = [];
let state = freshState();
let currentEvent = null;
let stage = 'diet'; // diet -> event -> resolved

// --- UI helpers
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function logLine(text) {
  const ts = `D${state.day}`;
  state.log.unshift({ ts, text });
  renderLog();
}

function save() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  logLine('（已存檔）');
}

function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return alert('沒有存檔。');
  state = JSON.parse(raw);
  stage = 'diet';
  currentEvent = null;
  logLine('（已讀檔）');
  renderAll();
}

function resetSave() {
  localStorage.removeItem(SAVE_KEY);
  alert('已清除存檔。');
}

function newGame() {
  state = freshState();
  stage = 'diet';
  currentEvent = null;
  renderAll();
  logLine('新局開始。封閉的空間會放大每一次選擇。');
}

// --- Core mechanics
function aliveChars() {
  return Object.values(state.chars).filter(c => c.alive);
}

function applyDietSelections() {
  // calculate cost + quality
  let food = 0, water = 0, dqSum = 0;
  for (const c of aliveChars()) {
    const opt = DIET_OPTIONS.find(o => o.key === c.todayDiet) || DIET_OPTIONS[2];
    food += opt.food;
    water += opt.water;
    dqSum += opt.dq;
  }

  if (state.resources.Food < food || state.resources.Water < water) {
    $('dietNote').textContent = `物資不足：需要 Food ${food} / Water ${water}，但你只有 Food ${state.resources.Food} / Water ${state.resources.Water}`;
    return false;
  }

  state.resources.Food -= food;
  state.resources.Water -= water;
  state.dayDietQuality = dqSum;
  state.dayDietCost = { Food: food, Water: water };

  // apply long-term trend: Body/Health/Stress
  for (const c of aliveChars()) {
    const opt = DIET_OPTIONS.find(o => o.key === c.todayDiet) || DIET_OPTIONS[2];
    // Body trend: -2..+1 -> scaled
    c.Body = clamp(c.Body + opt.dq * 2, 0, 100);
    // Health: good diet helps recovery, poor harms
    c.Health = clamp(c.Health + (opt.dq >= 1 ? 2 : opt.dq <= -1 ? -3 : 0), 0, 100);
    // Stress: hunger worsens
    c.Stress = clamp(c.Stress + (opt.key === 'none' ? 6 : opt.key === 'poor' ? 2 : -1), 0, 100);
  }

  $('dietNote').textContent = `今日消耗 Food ${food} / Water ${water}；飲食品質合計 ${dqSum}（影響體態/健康/壓力為長期趨勢）`;
  logLine(`你做了飲食分配：Food-${food} Water-${water}（DietQuality=${dqSum}）。`);
  return true;
}

function pickEvent() {
  const day = state.day;
  const candidates = EVENTS.filter(e => (!e.dayMin || day >= e.dayMin) && (!e.dayMax || day <= e.dayMax));
  // avoid repeating last
  const filtered = candidates.filter(e => e.id !== state.lastEventId);
  const pool = filtered.length ? filtered : candidates;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

function applyEffects(effects = {}) {
  const r = effects.resources || {};
  for (const [k,v] of Object.entries(r)) {
    if (state.resources[k] === undefined) state.resources[k] = 0;
    state.resources[k] = state.resources[k] + v;
  }

  const s = effects.status || {};
  // status effects apply to all alive by default
  for (const c of aliveChars()) {
    for (const [k,v] of Object.entries(s)) {
      if (c[k] === undefined) continue;
      c[k] = clamp(c[k] + v, 0, 100);
    }
  }

  const rel = effects.relations || {};
  for (const [cid, delta] of Object.entries(rel)) {
    const c = state.chars[cid];
    if (!c || !c.alive) continue;
    for (const [rk, rv] of Object.entries(delta)) {
      if (c[rk] === undefined) continue;
      c[rk] = clamp(c[rk] + rv, -100, 100);
    }
  }

  const fs = effects.flagsSet || [];
  const fc = effects.flagsClear || [];
  for (const f of fs) state.flags[f] = true;
  for (const f of fc) delete state.flags[f];
}

function resolveChoice(choice) {
  // cost
  if (choice.cost) {
    for (const [k,v] of Object.entries(choice.cost)) {
      if (state.resources[k] === undefined) state.resources[k] = 0;
      state.resources[k] = state.resources[k] - v;
    }
  }

  const out = choice.outcomes?.always || null;
  if (out?.text) logLine(out.text);
  if (out?.effects) applyEffects(out.effects);

  // clamp some global resources
  state.resources.Morale = clamp(state.resources.Morale, 0, 100);
  state.resources.Noise = clamp(state.resources.Noise, 0, 100);
  state.resources.ExploreRisk = clamp(state.resources.ExploreRisk, 0, 100);
  state.resources.Food = Math.max(0, state.resources.Food);
  state.resources.Water = Math.max(0, state.resources.Water);
  state.resources.Med = Math.max(0, state.resources.Med);
  state.resources.Ammo = Math.max(0, state.resources.Ammo);

  stage = 'resolved';
  renderAll();
  endOfDay();
}

function zombiePressureCheck() {
  // Non-human threat check each day.
  // Difficulty increases with Noise + ExploreRisk, decreased by COM (best defender).
  const noise = state.resources.Noise;
  const risk = state.resources.ExploreRisk;
  const defenders = aliveChars().map(c => ({ id: c.id, name: c.name, com: c.stats.COM }));
  defenders.sort((a,b) => b.com - a.com);
  const best = defenders[0];

  const difficulty = 35 + noise * 0.6 + risk * 0.8; // 35..>
  const roll = Math.random() * 100;
  const defend = (best?.com || 0) * 6; // 0..30
  const score = roll + defend;

  if (score >= difficulty) {
    // success: slight morale up, maybe ammo spent
    state.resources.Morale = clamp(state.resources.Morale + 2, 0, 100);
    if (state.resources.Ammo > 0 && (noise + risk) > 40) state.resources.Ammo -= 1;
    logLine(`喪屍壓力檢定：你們撐住了（守家：${best.name}）。`);
  } else {
    // fail: injury/infection and resource loss
    const victim = aliveChars()[Math.floor(Math.random() * aliveChars().length)];
    victim.Health = clamp(victim.Health - 10, 0, 100);
    victim.Infection = clamp(victim.Infection + 8, 0, 100);
    state.resources.Morale = clamp(state.resources.Morale - 6, 0, 100);
    state.resources.Noise = clamp(state.resources.Noise + 3, 0, 100);
    // small loss
    if (state.resources.Water > 0) state.resources.Water -= 1;
    logLine(`喪屍壓力檢定：牆外的抓撓聲逼近，你們付出了代價。${victim.name} 受傷，感染風險上升。`);
  }

  // ExploreRisk naturally decays a little each day
  state.resources.ExploreRisk = clamp(state.resources.ExploreRisk - 1, 0, 100);
}

function checkDeaths() {
  for (const c of aliveChars()) {
    if (c.Health <= 0 || c.Infection >= 100) {
      c.alive = false;
      logLine(`【死亡】${c.name} 沒能撐過這一天。`);
      state.resources.Morale = clamp(state.resources.Morale - 15, 0, 100);
    }
  }
}

function endOfDay() {
  zombiePressureCheck();
  checkDeaths();

  // day advance
  state.day += 1;
  stage = 'diet';
  currentEvent = null;

  renderAll();
}

// --- Render
function renderStatus() {
  const s = $('status');
  s.innerHTML = '';

  const kv = (k, v, smallText) => {
    const box = el('div','kv');
    box.appendChild(el('div','k',k));
    box.appendChild(el('div','v',String(v)));
    if (smallText) box.appendChild(el('div','small',smallText));
    s.appendChild(box);
  };

  kv('Day', state.day, '封閉空間：長期相處 + 長期消耗');
  kv('Food', state.resources.Food, '影響飲食品質與長期體態');
  kv('Water', state.resources.Water);
  kv('Med', state.resources.Med);
  kv('Ammo', state.resources.Ammo);
  kv('Morale', state.resources.Morale, '0 會讓事件更殘酷');
  kv('Noise', state.resources.Noise, '越高越容易引來牆外');
  kv('ExploreRisk', state.resources.ExploreRisk, '探索越多 → 壓力遞增');
}

function bodyDesc(x) {
  if (x <= 20) return '消瘦';
  if (x <= 40) return '偏瘦';
  if (x <= 60) return '勻稱';
  if (x <= 80) return '豐盈';
  return '更豐滿';
}

function renderDiet() {
  const grid = $('dietGrid');
  grid.innerHTML = '';

  for (const c of aliveChars()) {
    const row = el('div','char');

    const left = el('div');
    const name = el('div','name', c.name);
    const badge = el('span','badge', c.role);
    name.appendChild(badge);
    left.appendChild(name);
    left.appendChild(el('div','small', `Health ${c.Health} • Stress ${c.Stress} • Infection ${c.Infection} • Body ${c.Body}（${bodyDesc(c.Body)}）`));

    const sel = el('select');
    for (const o of DIET_OPTIONS) {
      const opt = el('option');
      opt.value = o.key;
      opt.textContent = `${o.label}  (Food ${o.food}, Water ${o.water})`;
      if (o.key === c.todayDiet) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => { c.todayDiet = sel.value; $('dietNote').textContent = ''; });

    const rel = el('div','small', `Affection ${c.Affection} • Trust ${c.Trust}`);
    const stats = el('div','small', `STR ${c.stats.STR}  LOG ${c.stats.LOG}  CHA ${c.stats.CHA}  COM ${c.stats.COM}`);

    row.appendChild(left);
    row.appendChild(sel);
    row.appendChild(rel);
    row.appendChild(stats);
    grid.appendChild(row);
  }

  $('btnApplyDiet').disabled = (stage !== 'diet');
}

function renderEvent() {
  const host = $('event');
  host.innerHTML = '';

  if (stage === 'diet') {
    host.appendChild(el('div','card', '')); 
    host.querySelector('.card').appendChild(el('div','text','先完成「今日飲食分配」，再開始事件。'));
    return;
  }

  if (!currentEvent) {
    host.appendChild(el('div','card',''));
    host.querySelector('.card').appendChild(el('div','text','（沒有事件）'));
    return;
  }

  const card = el('div','card');
  card.appendChild(el('div','title', currentEvent.title));
  card.appendChild(el('div','text', currentEvent.text));

  const choices = el('div','choices');
  for (const ch of currentEvent.choices) {
    const b = el('button','choice', ch.label);
    b.addEventListener('click', () => resolveChoice(ch));
    choices.appendChild(b);
  }
  card.appendChild(choices);

  host.appendChild(card);
}

function renderLog() {
  const host = $('log');
  host.innerHTML = '';
  for (const l of state.log.slice(0, 80)) {
    const line = el('div','logline');
    line.textContent = `[${l.ts}] ${l.text}`;
    host.appendChild(line);
  }
}

function renderAll() {
  renderStatus();
  renderDiet();
  renderEvent();
  renderLog();
}

// --- Wiring
$('btnNew').addEventListener('click', newGame);
$('btnSave').addEventListener('click', save);
$('btnLoad').addEventListener('click', load);
$('btnReset').addEventListener('click', resetSave);

$('btnApplyDiet').addEventListener('click', async () => {
  if (stage !== 'diet') return;
  const ok = applyDietSelections();
  if (!ok) return;

  currentEvent = pickEvent();
  state.lastEventId = currentEvent.id;
  stage = 'event';
  renderAll();
});

async function boot() {
  const res = await fetch('./data/events.json');
  EVENTS = await res.json();
  renderAll();
  logLine('原型已就緒：先分配飲食，再面對事件。');
}

boot();
