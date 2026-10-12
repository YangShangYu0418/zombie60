import { Game, buildData, DIET_OPTIONS, RES_LABEL, STAT_LABEL, CAMPAIGN_DAYS } from './src/engine.js';
import { runScavenge } from './src/scavenge.js';

const SAVE_KEY = 'zombie60.save.v2';

let data = null;
let game = null;
let selectedLoc = null;
let activeTab = 'quests';
let scavengeHandle = null;

// ---------------------------------------------------------------------------
// tiny DOM helper

const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style') n.setAttribute('style', v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === undefined || kid === null || kid === false) continue;
    n.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return n;
}
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

function bar(value, max, cls) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return h('div', { class: `bar ${cls || ''}` }, h('div', { class: 'fill', style: `width:${pct}%` }));
}
function relBar(value) {
  // -100..100 centered bar
  const pct = Math.abs(value) / 2;
  const side = value >= 0 ? `left:50%;width:${pct}%` : `left:${50 - pct}%;width:${pct}%`;
  return h('div', { class: `bar rel ${value < 0 ? 'neg' : ''}` }, h('div', { class: 'fill', style: side }), h('div', { class: 'mid' }));
}

function bodyDesc(x) {
  if (x <= 20) return '消瘦';
  if (x <= 40) return '偏瘦';
  if (x <= 60) return '勻稱';
  if (x <= 80) return '豐盈';
  return '豐滿';
}

// ---------------------------------------------------------------------------
// Rendering

function render() {
  if (!game) return;
  renderHeader();
  renderResources();
  renderStage();
  renderTeam();
  renderMap();
  renderFeed();
  renderTabs();
}

function renderHeader() {
  const s = game.state;
  const w = data.world.weather[s.world.weather];
  $('dayChip').textContent = s.phase === 'intro' || s.phase === 'scavenge' ? '爆發當日' : `第 ${s.day} / ${CAMPAIGN_DAYS} 天`;
  $('weatherTag').textContent = s.phase === 'intro' || s.phase === 'scavenge' ? '' : `天氣：${w?.name || ''}`;
  $('mapWrap').className = `map-wrap weather-${s.world.weather}`;
}

function renderResources() {
  const r = game.state.resources;
  const host = $('resbar');
  host.innerHTML = '';
  const tip = {
    Food: '每人每天基本 1', Water: '每人每天基本 1', Med: '可在隊伍面板用藥', Ammo: '夜間防守與戰鬥', Parts: '修繕、加固、交易',
    Morale: '≥70 檢定 +1；≤20 壓力上升', Noise: '越高越引屍潮', ExploreRisk: '外派累積，夜間壓力上升', Defense: '抵擋夜間襲擊',
  };
  for (const k of Object.keys(RES_LABEL)) {
    const v = r[k];
    const warn = (k === 'Food' || k === 'Water') && v <= game.present().length
      || (k === 'Noise' && v >= 40) || (k === 'ExploreRisk' && v >= 40) || (k === 'Morale' && v <= 25) || (k === 'Defense' && v <= 10);
    host.appendChild(h('div', { class: `res${warn ? ' warn' : ''}`, title: tip[k] }, h('span', { class: 'k' }, RES_LABEL[k]), h('span', { class: 'v' }, v)));
  }
}

let lastScene = null;
function renderStage() {
  const s = game.state;
  const host = $('stage');
  // On narrow screens, bring each new scene back into view.
  const scene = `${s.day}:${s.phase}:${s.today?.eventId}`;
  if (lastScene && scene !== lastScene && window.innerWidth < 960 && host.getBoundingClientRect().top < 0) host.scrollIntoView({ behavior: 'smooth' });
  lastScene = scene;
  if (s.phase === 'scavenge') return; // owned by scavenge module
  host.innerHTML = '';
  if (s.phase === 'intro') return renderIntro(host);
  if (s.phase === 'plan') return renderPlan(host);
  if (s.phase === 'event') return renderEvent(host);
  if (s.phase === 'outcome') return renderOutcome(host);
  if (s.phase === 'ended') return renderEnding(host);
}

function renderIntro(host) {
  host.append(
    h('div', { class: 'card hero' },
      h('div', { class: 'eyebrow' }, '爆發當日・下午四點十七分'),
      h('div', { class: 'title' }, '六十秒'),
      h('div', { class: 'text' }, data.world.intro),
      h('div', { class: 'choices' },
        h('button', { class: 'choice primary', onclick: startScavenge }, '開始 60 秒搜刮', h('span', { class: 'hint' }, '帶物資、帶人進地下室。沒帶到的人會失散在外面。')),
        h('button', { class: 'choice', onclick: () => { game.startStandard(); persist(); } }, '跳過：標準開局', h('span', { class: 'hint' }, '四個人都在，物資普通。')),
      ),
    ),
  );
}

function startScavenge() {
  game.state.phase = 'scavenge';
  render();
  const host = $('stage');
  scavengeHandle = runScavenge(host, null, (result) => {
    scavengeHandle = null;
    host.innerHTML = '';
    game.startFromScavenge(result);
    persist();
  });
}

function renderPlan(host) {
  const s = game.state;
  const { food, water } = game.dietCost();
  const w = data.world.weather[s.world.weather];
  const card = h('div', { class: 'card' });
  card.append(h('div', { class: 'eyebrow' }, `第 ${s.day} 天・${w?.name || ''}`), h('div', { class: 'title' }, '清晨・今日計畫'));

  if (s.nightLines?.length) {
    const nl = h('div', { class: 'nightlines' });
    for (const l of s.nightLines) nl.appendChild(h('div', { class: 'nightline' }, l.name ? h('b', {}, `${l.name}　`) : null, l.text));
    card.appendChild(nl);
  }
  const todays = s.log.filter(l => l.day === s.day && l.kind !== 'info').slice(0, 6).reverse();
  if (todays.length) {
    const box = h('div', { class: 'morning' });
    for (const l of todays) box.appendChild(h('div', { class: `logline k-${l.kind}` }, l.text));
    card.appendChild(box);
  }

  const exp = Object.entries(s.plan.expeditions);
  card.appendChild(h('div', { class: 'plan' },
    h('div', {}, `飲食：食物 −${food}／飲水 −${water}（庫存 ${s.resources.Food}／${s.resources.Water}）`),
    h('div', {}, exp.length ? `外派：${exp.map(([cid, l]) => `${game.displayName(game.char(cid))} → ${game.locName(l)}`).join('、')}` : '外派：無（在隊伍面板或地圖上指派）'),
  ));
  const comps = game.presentHeroines().filter(c => !s.plan.expeditions[c.id]);
  if (comps.length && !s.plan.expeditions[game.player().id]) {
    card.appendChild(h('div', { class: 'plan' }, h('label', {}, '今晚陪誰　',
      h('select', { onchange: (ev) => game.setCompanion(ev.target.value || null) },
        h('option', { value: '' }, '各自休息'),
        comps.map(c => h('option', { value: c.id, selected: s.plan.companion === c.id }, `${c.name}（好感 ${c.Affection}）`)))),
      h('span', { class: 'muted' }, '　好感 +2、壓力 −4，夜裡更可能有她的場景')));
  }
  const note = h('div', { class: 'note', id: 'planNote' });
  card.appendChild(h('div', { class: 'row' },
    h('button', { onclick: () => game.autoRation() }, '自動配給'),
    h('button', { class: 'primary', onclick: () => {
      const res = game.commitPlan();
      if (!res.ok) { $('planNote').textContent = res.reason; return; }
      persist();
    } }, '開始今天'),
    note,
  ));
  host.appendChild(card);
}

function renderEvent(host) {
  const e = game.currentEvent();
  if (!e) return;
  const vars = game.textVars();
  const ctx = game.state.today.ctx;
  const card = h('div', { class: 'card event' });
  const where = e.pool?.startsWith('loc:') ? game.locName(e.pool.slice(4)) : null;
  const stage = game.state.today.stage;
  const tag = stage === 'night' ? '夜話' : stage === 'return' && where ? `外派歸來・${where}` : ({ story: '劇情', romance: '關係', world: '外界', shelter: '地下室', queued: '劇情' }[e.pool] || (where ? `外派・${where}` : ''));
  card.append(
    h('div', { class: 'eyebrow' }, `第 ${game.state.day} 天${tag ? `・${tag}` : ''}${ctx.actor && where ? `・${game.displayName(game.char(ctx.actor))}` : ''}`),
    h('div', { class: 'title' }, e.title),
    h('div', { class: 'text' }, game.fill(e.text, vars)),
  );
  const choices = h('div', { class: 'choices' });
  e.choices.forEach((ch, i) => {
    const block = game.choiceBlock(ch);
    const meta = [];
    if (ch.cost) {
      const c = Object.entries(ch.cost).filter(([, v]) => v).map(([k, v]) => `${RES_LABEL[k]} ${v > 0 ? '−' : '+'}${Math.abs(v)}`);
      if (c.length) meta.push(c.join(' '));
    }
    if (ch.check && !block) {
      const who = game.checker(ch.check);
      meta.push(`${game.displayName(who)}・${STAT_LABEL[ch.check.stat]}檢定 ${Math.round(game.checkChance(ch.check) * 100)}%`);
    }
    if (block) meta.push(block);
    choices.appendChild(h('button', { class: 'choice', disabled: !!block, onclick: () => { game.choose(i); persist(); } },
      game.fill(ch.label, vars), meta.length ? h('span', { class: 'hint' }, meta.join('　')) : null));
  });
  if (game.allBlocked(e)) {
    choices.appendChild(h('button', { class: 'choice', onclick: () => { game.choose(-1); persist(); } },
      Game.HELPLESS.label, h('span', { class: 'hint' }, '所有選項的條件都不滿足')));
  }
  card.appendChild(choices);
  host.appendChild(card);
}

function renderOutcome(host) {
  const o = game.state.outcome;
  const card = h('div', { class: 'card outcome' });
  card.append(h('div', { class: 'eyebrow' }, o.title), h('div', { class: 'chosen' }, `▸ ${o.label}`));
  if (o.check) {
    const c = o.check;
    card.appendChild(h('div', { class: `check ${c.ok ? 'ok' : 'bad'}` },
      `🎲 ${c.who}・${STAT_LABEL[c.stat]}　${c.total - c.die} + ${c.die} = ${c.total}　${c.ok ? '≥' : '<'} ${c.dc}　${c.ok ? '成功' : '失敗'}`));
  }
  for (const t of o.texts) card.appendChild(h('div', { class: 'text' }, t));
  if (o.deltas.length) {
    const chips = h('div', { class: 'deltas' });
    for (const d of o.deltas) {
      const goodWhenUp = !['Noise', 'ExploreRisk', 'Stress', 'Infection'].includes(d.key);
      const good = d.d > 0 === goodWhenUp;
      chips.appendChild(h('span', { class: `delta ${good ? 'up' : 'down'}` }, `${d.label} ${d.d > 0 ? '+' : ''}${d.d}`));
    }
    card.appendChild(chips);
  }
  const label = { return: '繼續・白天', day: '入夜', night: '結束這一天' }[game.state.today.stage] || '繼續';
  card.appendChild(h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { game.endDay(); persist(); } }, label)));
  host.appendChild(card);
}

function renderEnding(host) {
  const s = game.state;
  const e = s.ending;
  const card = h('div', { class: `card ending k-${e.kind}` });
  card.append(h('div', { class: 'eyebrow' }, `結局・第 ${e.day} 天`), h('div', { class: 'title' }, e.title), h('div', { class: 'text' }, e.text));
  const alive = Object.values(s.chars).filter(c => c.alive).map(c => game.displayName(c));
  const sum = h('div', { class: 'summary' },
    h('div', {}, `存活：${alive.join('、') || '無'}`),
    h('div', {}, `外派次數 ${s.stats.expeditions}・經歷事件 ${s.stats.eventsSeen}・探索地點 ${Object.keys(s.world.discovered).length}/${data.world.locations.length}`),
    ...game.heroines().map(c => h('div', {}, `${c.name}：好感 ${c.Affection}・信任 ${c.Trust}${c.alive ? '' : '（已故）'}`)),
  );
  card.appendChild(sum);
  card.appendChild(h('div', { class: 'row' }, h('button', { class: 'primary', onclick: newGame }, '再活一次')));
  host.appendChild(card);
}

function renderTeam() {
  const s = game.state;
  const host = $('team');
  host.innerHTML = '';
  const planning = s.phase === 'plan';
  const locs = data.world.locations.filter(l => l.id !== 'home' && s.world.discovered[l.id]);
  for (const c of Object.values(s.chars)) {
    const statusTxt = !c.alive ? '已故'
      : c.status === 'away' ? `外派・${game.locName(c.away.loc)}（第 ${c.away.returnDay} 天回）`
      : c.status === 'missing' ? `失散・最後出現在${game.locName(c.missingAt)}`
      : planning && s.plan.expeditions[c.id] ? `準備出發 → ${game.locName(s.plan.expeditions[c.id])}` : '在地下室';
    const card = h('div', { class: `member${c.alive ? '' : ' dead'}${c.status !== 'home' ? ' away' : ''}` });
    card.appendChild(h('div', { class: 'm-head' },
      h('span', { class: 'm-name' }, c.isPlayer ? `${c.name}（你）` : c.name),
      h('span', { class: 'badge' }, c.role),
      h('span', { class: 'm-status' }, statusTxt)));
    if (c.alive && c.status !== 'missing') {
      card.appendChild(h('div', { class: 'm-bars' },
        h('label', {}, `健康 ${c.Health}`, bar(c.Health, 100, 'hp')),
        h('label', {}, `壓力 ${c.Stress}`, bar(c.Stress, 100, 'stress')),
        h('label', {}, `感染 ${c.Infection}`, bar(c.Infection, 100, 'inf')),
        h('label', {}, `體態 ${bodyDesc(c.Body)}`, bar(c.Body, 100, 'body')),
      ));
      if (!c.isPlayer) {
        card.appendChild(h('div', { class: 'm-bars rel2' },
          h('label', {}, `好感 ${c.Affection}`, relBar(c.Affection)),
          h('label', {}, `信任 ${c.Trust}`, relBar(c.Trust))));
      }
      card.appendChild(h('div', { class: 'm-stats' }, Object.entries(c.stats).map(([k, v]) => `${STAT_LABEL[k]} ${v}`).join('　')));
    }
    if (planning && c.alive && c.status === 'home') {
      const diet = h('select', { onchange: (ev) => { c.todayDiet = ev.target.value; render(); } },
        DIET_OPTIONS.map(o => h('option', { value: o.key, selected: o.key === c.todayDiet }, `${o.label}（食${o.food}・水${o.water}）`)));
      const exp = h('select', { onchange: (ev) => game.setExpedition(c.id, ev.target.value || null) },
        h('option', { value: '' }, '留守'),
        locs.map(l => h('option', { value: l.id, selected: s.plan.expeditions[c.id] === l.id },
          `外派 ${l.name}（${l.dist} 天・危險 ${l.danger}・屍 ${s.world.density[l.id]}）`)));
      const actions = h('div', { class: 'm-actions' }, h('label', {}, '飲食 ', diet), h('label', {}, '行動 ', exp));
      if (game.canUseMed(c)) actions.appendChild(h('button', { class: 'small-btn', onclick: () => { game.useMed(c.id); persist(); } }, '用藥（Med −1）'));
      card.appendChild(actions);
    }
    host.appendChild(card);
  }
}

function densityColor(d) {
  // green → amber → red
  const t = Math.min(1, d / 100);
  const r = Math.round(40 + 200 * t), g = Math.round(190 - 140 * t), b = Math.round(90 - 50 * t);
  return `rgb(${r},${g},${b})`;
}

function renderMap() {
  const s = game.state;
  const m = $('map');
  m.innerHTML = '';
  const disc = s.world.discovered;
  // Edges between discovered locations
  for (const [a, b] of data.world.edges) {
    if (!disc[a] || !disc[b]) continue;
    const A = game.loc(a), B = game.loc(b);
    m.appendChild(svg('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'edge' }));
  }
  // Undiscovered locations adjacent to discovered ones show as faint "?"
  for (const l of data.world.locations) {
    if (disc[l.id]) continue;
    if (!data.adj[l.id].some(n => disc[n])) continue;
    m.appendChild(svg('circle', { cx: l.x, cy: l.y, r: 1.6, class: 'unknown' }));
    const t = svg('text', { x: l.x, y: l.y + 0.9, class: 'qmark' });
    t.textContent = '?';
    m.appendChild(t);
  }
  // Hordes (visible if at/adjacent to something discovered)
  for (const hd of s.world.hordes) {
    const l = game.loc(hd.at);
    if (!disc[hd.at] && !data.adj[hd.at].some(n => disc[n])) continue;
    m.appendChild(svg('circle', { cx: l.x, cy: l.y, r: 3 + hd.size / 15, class: 'horde' }));
  }
  for (const l of data.world.locations) {
    if (!disc[l.id]) continue;
    const g = svg('g', { class: `node${selectedLoc === l.id ? ' sel' : ''}${l.id === 'home' ? ' home' : ''}`, tabindex: 0 });
    g.addEventListener('click', () => { selectedLoc = l.id; renderMap(); });
    g.appendChild(svg('circle', { cx: l.x, cy: l.y, r: l.id === 'home' ? 3 : 2.3, fill: l.id === 'home' ? '#facc15' : densityColor(s.world.density[l.id]) }));
    const label = svg('text', { x: l.x, y: l.y - 3.6, class: 'label' });
    label.textContent = l.short || l.name;
    g.appendChild(label);
    m.appendChild(g);
  }
  // Expedition markers and missing heroines
  const away = Object.values(s.chars).filter(c => c.alive && c.status === 'away');
  away.forEach((c, i) => {
    const l = game.loc(c.away.loc);
    const t = svg('text', { x: l.x + 3 + i * 3, y: l.y + 3.5, class: 'pawn' });
    t.textContent = c.isPlayer ? '你' : c.name[1];
    m.appendChild(t);
  });
  for (const c of game.heroines()) {
    if (!c.alive || c.status !== 'missing' || !disc[c.missingAt]) continue;
    const l = game.loc(c.missingAt);
    const t = svg('text', { x: l.x - 4.5, y: l.y + 3.5, class: 'pawn missing' });
    t.textContent = `${c.name[1]}?`;
    m.appendChild(t);
  }

  // Location info
  const info = $('locInfo');
  info.innerHTML = '';
  const l = selectedLoc && game.loc(selectedLoc);
  if (!l) { info.appendChild(h('div', { class: 'muted' }, '點擊地圖上的地點查看情報。紅圈是屍潮。')); return; }
  const fac = data.world.factions.find(f => f.home === l.id);
  const loot = Object.keys(l.loot || {}).map(k => RES_LABEL[k]).join('、');
  info.append(...[
    h('div', { class: 'li-title' }, l.name, l.id !== 'home' ? h('span', { class: 'badge' }, `${l.dist} 天・危險 ${l.danger}・屍密度 ${s.world.density[l.id]}`) : null),
    h('div', { class: 'li-desc' }, l.desc),
    loot ? h('div', { class: 'muted' }, `可能找到：${loot}`) : null,
    fac ? h('div', { class: 'muted' }, `勢力：${fac.name}（聲望 ${s.factions[fac.id]}）`) : null,
  ].filter(Boolean));
  if (s.phase === 'plan' && l.id !== 'home') {
    const avail = game.present().filter(c => !s.plan.expeditions[c.id]);
    if (avail.length > 1) {
      info.appendChild(h('div', { class: 'row' }, avail.map(c =>
        h('button', { class: 'small-btn', onclick: () => game.setExpedition(c.id, l.id) }, `派${game.displayName(c)}去`))));
    }
  }
}

function renderFeed() {
  const s = game.state;
  const r = $('radio');
  r.innerHTML = '';
  if (s.radio) r.appendChild(h('div', { class: 'radio-line' }, h('span', { class: 'radio-ico' }, '📻'), s.radio));
  else if (!s.flags.hasRadio) r.appendChild(h('div', { class: 'muted' }, '（沒有收音機。外面的消息只能靠耳朵和運氣。）'));
  const f = $('feed');
  f.innerHTML = '';
  for (const n of s.feed.slice(0, 14)) f.appendChild(h('div', { class: `feedline k-${n.kind}` }, h('span', { class: 'd' }, `D${n.day}`), n.text));
}

function renderTabs() {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
  const host = $('tabBody');
  host.innerHTML = '';
  const s = game.state;
  if (activeTab === 'quests') {
    const qs = game.questProgress();
    if (!qs.length) host.appendChild(h('div', { class: 'muted' }, '還沒有任務。活下去，世界會找上你。'));
    for (const q of qs) {
      const box = h('div', { class: `quest${q.done ? ' done' : ''}` }, h('div', { class: 'q-title' }, q.title), q.summary ? h('div', { class: 'muted' }, q.summary) : null);
      q.stages.forEach((st, i) => { if (i <= q.reached) box.appendChild(h('div', { class: `q-stage${i === q.reached ? ' cur' : ''}` }, st.text)); });
      host.appendChild(box);
    }
  } else if (activeTab === 'factions') {
    const metMap = { nightmarket: 'metNightmarket', students: 'metStudents', military: 'metMilitary', blackrain: 'metBlackrain' };
    for (const f of data.world.factions) {
      const met = s.flags[metMap[f.id]];
      host.appendChild(h('div', { class: 'faction' },
        h('div', { class: 'q-title' }, met ? f.name : '？？？', h('span', { class: 'badge' }, `聲望 ${s.factions[f.id]}`)),
        h('div', { class: 'muted' }, met ? f.desc : `據說盤踞在${s.world.discovered[f.home] ? game.locName(f.home) : '某處'}。`),
        relBar(s.factions[f.id])));
    }
  } else {
    for (const l of s.log.slice(0, 120)) host.appendChild(h('div', { class: `logline k-${l.kind}` }, h('span', { class: 'd' }, `D${l.day}`), l.text));
  }
}

// ---------------------------------------------------------------------------
// Save / load

function persist() {
  try { localStorage.setItem(SAVE_KEY, game.serialize()); } catch { /* storage unavailable */ }
}

function save() {
  persist();
  game.log('（已存檔）');
  render();
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { /* ignore */ }
  if (!raw) return alert('沒有存檔。');
  try {
    attach(Game.deserialize(data, raw));
    game.log('（已讀檔）');
    render();
  } catch (e) {
    alert(e.message);
  }
}

function newGame() {
  if (game && game.state.phase !== 'intro' && game.state.phase !== 'ended' && !confirm('放棄目前的進度，重新開始？')) return;
  scavengeHandle?.abort();
  scavengeHandle = null;
  selectedLoc = null;
  attach(new Game(data));
  persist();
  render();
}

function attach(g) {
  game = g;
  game.onChange(() => render());
  // A save made mid-scavenge can't resume the minigame; fall back to the intro.
  if (game.state.phase === 'scavenge') game.state.phase = 'intro';
}

// ---------------------------------------------------------------------------
// Boot

async function fetchJSON(p) {
  const res = await fetch(p);
  if (!res.ok) throw new Error(`${p}: ${res.status}`);
  return res.json();
}

async function boot() {
  const manifest = await fetchJSON('./data/manifest.json');
  const [world, characters, endings, flavor, ...contentFiles] = await Promise.all([
    fetchJSON('./data/world.json'),
    fetchJSON('./data/characters.json'),
    fetchJSON('./data/endings.json'),
    fetchJSON(`./data/${manifest.flavor}`).catch(() => ({})),
    ...manifest.content.map(f => fetchJSON(`./data/${f}`).catch(err => { console.warn('content missing', f, err); return { events: [] }; })),
  ]);
  data = buildData({ world, characters, endings, flavor, contentFiles });

  $('btnNew').addEventListener('click', newGame);
  $('btnSave').addEventListener('click', save);
  $('btnLoad').addEventListener('click', load);
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { activeTab = b.dataset.tab; renderTabs(); }));

  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { /* ignore */ }
  try { attach(raw ? Game.deserialize(data, raw) : new Game(data)); }
  catch { attach(new Game(data)); }
  render();
}

boot().catch(err => {
  $('stage').textContent = `載入失敗：${err.message}（請用本地伺服器開啟，例如 npx serve 或 python -m http.server）`;
  console.error(err);
});
