// 60-second scavenge (opening). Tap/click a tile to walk there; arrow keys / WASD also work.
// Walk over items to pick them up (bag capacity CAP slots), walk over a heroine to bring her along,
// step onto the basement door (B) to drop everything off.

const MAP = [
  '###############',
  '#RRR#KKK#UUUUU#',
  '#RRR+KKK#UUUUU#',
  '#RRR#KKK#UUUUU#',
  '##+###+####+###',
  '#LLLLLLL#SSSSS#',
  '#LLLLLLL+SSSSS#',
  '####+######+###',
  '#AAAAAAAAAAAAA#',
  '#AAAAAAAAAAAAA#',
  '##+######+#####',
  '#BBB#IIIIIIIII#',
  '#BBB#IIIIIIIII#',
  '###############',
];
const ZONE = { R: '臥室', K: '廚房', U: '黎霜家', L: '客廳', S: '樓梯間', A: '後巷', B: '地下室', I: '居酒屋「寧」' };
const CAP = 4;
const SECONDS = 60;
const STEP_MS = 210;

const ITEMS = [
  { id: 'can', icon: '🥫', name: '罐頭', slots: 1, zones: 'KKLI', count: 5, effects: { resources: { Food: 2 } } },
  { id: 'water', icon: '💧', name: '礦泉水', slots: 1, zones: 'KUIS', count: 4, effects: { resources: { Water: 2 } } },
  { id: 'rice', icon: '🍚', name: '米袋', slots: 2, zones: 'I', count: 1, effects: { resources: { Food: 4 } } },
  { id: 'med', icon: '🩹', name: '急救箱', slots: 1, zones: 'RU', count: 1, effects: { resources: { Med: 2 } } },
  { id: 'tools', icon: '🔧', name: '工具箱', slots: 1, zones: 'U', count: 1, effects: { resources: { Parts: 3 } } },
  { id: 'radio', icon: '📻', name: '收音機', slots: 1, zones: 'UL', count: 1, effects: { flagsSet: ['hasRadio'] } },
  { id: 'map', icon: '🗺️', name: '紙本地圖', slots: 1, zones: 'L', count: 1, effects: { flagsSet: ['hasMap'], discover: ['shenkeng_school', 'nccu', 'zoo'] } },
  { id: 'axe', icon: '🪓', name: '消防斧', slots: 1, zones: 'A', count: 1, effects: { resources: { Defense: 8 } } },
  { id: 'gun', icon: '🔫', name: '空氣槍與鋼珠', slots: 1, zones: 'R', count: 1, effects: { resources: { Ammo: 3 } } },
  { id: 'sake', icon: '🍶', name: '清酒', slots: 1, zones: 'I', count: 1, effects: { resources: { Morale: 6 } } },
  { id: 'battery', icon: '🔋', name: '電池組', slots: 1, zones: 'SU', count: 1, effects: { resources: { Parts: 1 } } },
  { id: 'tarp', icon: '🧥', name: '防水布', slots: 1, zones: 'AS', count: 1, effects: { resources: { Parts: 1, Defense: 2 } } },
];
const PEOPLE = [
  { id: 'liShuang', glyph: '霜', name: '黎霜', zone: 'U', slots: 2 },
  { id: 'songNing', glyph: '寧', name: '宋寧', zone: 'I', slots: 2 },
  { id: 'xiaJian', glyph: '見', name: '夏見', zone: 'A', slots: 2 },
];

function tilesOf(zone) {
  const out = [];
  MAP.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === zone) out.push([x, y]); }));
  return out;
}
const walkable = (x, y) => MAP[y] && MAP[y][x] && MAP[y][x] !== '#';
const key = (x, y) => `${x},${y}`;

function bfs(from, to) {
  const prev = { [key(...from)]: null };
  const q = [from];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === to[0] && y === to[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (walkable(nx, ny) && !(key(nx, ny) in prev)) { prev[key(nx, ny)] = [x, y]; q.push([nx, ny]); }
    }
  }
  if (!(key(...to) in prev)) return [];
  const path = [];
  for (let n = to; n && key(...n) !== key(...from); n = prev[key(...n)]) path.unshift(n);
  return path;
}

export function runScavenge(host, intro, onDone) {
  const rnd = Math.random;
  const used = new Set();
  const placeIn = (zones) => {
    const opts = [...zones].flatMap(z => tilesOf(z)).filter(t => !used.has(key(...t)));
    const t = opts[Math.floor(rnd() * opts.length)];
    used.add(key(...t));
    return t;
  };
  used.add(key(3, 5)); // start tile
  const things = [];
  for (const p of PEOPLE) { const [x, y] = placeIn(p.zone); things.push({ kind: 'person', ...p, x, y, state: 'idle' }); }
  for (const it of ITEMS) for (let i = 0; i < it.count; i++) { const [x, y] = placeIn(it.zones); things.push({ kind: 'item', ...it, x, y, state: 'idle' }); }

  const st = { pos: [3, 5], path: [], bag: [], saved: [], left: SECONDS, running: false, done: false, msg: '' };

  host.innerHTML = '';
  host.classList.add('scavenge');
  const top = document.createElement('div');
  top.className = 'sc-top';
  const grid = document.createElement('div');
  grid.className = 'sc-grid';
  grid.style.gridTemplateColumns = `repeat(${MAP[0].length}, 1fr)`;
  const side = document.createElement('div');
  side.className = 'sc-side';
  host.append(top, grid, side);

  const cells = {};
  MAP.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = document.createElement('div');
    c.className = `sc-cell z-${ch === '#' ? 'wall' : ch === '+' ? 'door' : ch}`;
    if (walkable(x, y)) c.addEventListener('click', () => { if (st.running) st.path = bfs(st.pos, [x, y]); });
    grid.appendChild(c);
    cells[key(x, y)] = c;
  }));
  // Zone labels
  const labeled = new Set();
  MAP.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ZONE[ch] && !labeled.has(ch)) { labeled.add(ch); const lb = document.createElement('span'); lb.className = 'sc-label'; lb.textContent = ZONE[ch]; cells[key(x, y)].appendChild(lb); }
  }));

  const bagSlots = () => st.bag.reduce((a, t) => a + t.slots, 0);

  function render() {
    for (const c of Object.values(cells)) { c.querySelector('.sc-tok')?.remove(); c.classList.remove('sc-path'); }
    for (const [x, y] of st.path) cells[key(x, y)]?.classList.add('sc-path');
    for (const t of things) {
      if (t.state !== 'idle') continue;
      const tok = document.createElement('span');
      tok.className = `sc-tok ${t.kind === 'person' ? 'sc-person' : 'sc-item'}`;
      tok.textContent = t.kind === 'person' ? t.glyph : t.icon;
      tok.title = t.name;
      cells[key(t.x, t.y)].appendChild(tok);
    }
    const me = document.createElement('span');
    me.className = 'sc-tok sc-me';
    me.textContent = '你';
    cells[key(...st.pos)].appendChild(me);

    const urgent = st.left <= 10;
    top.innerHTML = '';
    const timer = document.createElement('div');
    timer.className = `sc-timer${urgent ? ' urgent' : ''}`;
    timer.textContent = st.running || st.done ? `${Math.ceil(st.left)}s` : `${SECONDS}s`;
    const bag = document.createElement('div');
    bag.className = 'sc-bag';
    bag.textContent = `背包 ${bagSlots()}/${CAP}：${st.bag.map(t => t.kind === 'person' ? t.name : t.icon).join(' ') || '空'}`;
    top.append(timer, bag);

    side.innerHTML = '';
    const savedTxt = document.createElement('div');
    savedTxt.className = 'sc-saved';
    savedTxt.textContent = `已帶進地下室：${st.saved.map(t => t.kind === 'person' ? t.name : t.icon).join(' ') || '（還沒有）'}`;
    const msg = document.createElement('div');
    msg.className = 'sc-msg';
    msg.textContent = st.msg || '點擊地圖移動（或方向鍵／WASD）。踩到物品就撿起來，踩到人就帶她走，回到「地下室」放下。';
    side.append(savedTxt, msg);
    if (!st.running && !st.done) {
      const go = document.createElement('button');
      go.className = 'primary';
      go.textContent = '開始倒數（60 秒）';
      go.onclick = start;
      side.appendChild(go);
    }
  }

  function arrive() {
    const [x, y] = st.pos;
    for (const t of things) {
      if (t.state !== 'idle' || t.x !== x || t.y !== y) continue;
      if (bagSlots() + t.slots > CAP) { st.msg = `背包滿了，放不下${t.name}。先回地下室。`; continue; }
      t.state = 'bag';
      st.bag.push(t);
      st.msg = t.kind === 'person' ? `${t.name}抓住你的手：『走！』` : `撿起了${t.name}。`;
    }
    if (MAP[y][x] === 'B' && st.bag.length) {
      for (const t of st.bag) { t.state = 'saved'; st.saved.push(t); }
      st.msg = `放下了 ${st.bag.length} 樣東西。還有時間嗎？`;
      st.bag = [];
    }
  }

  function step() {
    if (!st.path.length) return;
    st.pos = st.path.shift();
    arrive();
  }

  function onKey(e) {
    if (!st.running) return;
    const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[e.key];
    if (!d) return;
    e.preventDefault();
    const nx = st.pos[0] + d[0], ny = st.pos[1] + d[1];
    if (walkable(nx, ny)) { st.path = [[nx, ny]]; }
  }

  let tickTimer = null, moveTimer = null, last = 0;
  function start() {
    st.running = true;
    st.msg = '跑！';
    last = performance.now();
    window.addEventListener('keydown', onKey);
    moveTimer = setInterval(() => { step(); render(); }, STEP_MS);
    tickTimer = setInterval(() => {
      const now = performance.now();
      st.left -= (now - last) / 1000;
      last = now;
      if (st.left <= 0) finish();
      else render();
    }, 100);
    render();
  }

  function finish() {
    st.running = false;
    st.done = true;
    st.left = 0;
    clearInterval(tickTimer);
    clearInterval(moveTimer);
    window.removeEventListener('keydown', onKey);
    const atDoor = MAP[st.pos[1]][st.pos[0]] === 'B';
    const lostBag = !atDoor && st.bag.length > 0;
    const items = st.saved.filter(t => t.kind === 'item');
    const rescued = st.saved.filter(t => t.kind === 'person').map(t => t.id);
    // Make sure the player always ends up inside; anyone still in the bag outside is lost.
    render();
    const left = PEOPLE.filter(p => !rescued.includes(p.id)).map(p => p.name);
    side.innerHTML = '';
    const sum = document.createElement('div');
    sum.className = 'sc-msg';
    sum.textContent = `鐵門落下。帶下來：${items.map(t => t.name).join('、') || '幾乎什麼都沒有'}。`
      + (left.length ? `\n沒趕上的人：${left.join('、')}——她們會在外面的某處。` : '\n三個人都在。')
      + (lostBag ? '\n你沒來得及回到門口，背包裡的東西掉在了樓梯上。' : '');
    const go = document.createElement('button');
    go.className = 'primary';
    go.textContent = '進入第一天';
    go.onclick = () => { host.classList.remove('scavenge'); onDone({ items, rescued, lostBag }); };
    side.append(sum, go);
  }

  if (intro) st.msg = intro;
  render();
  return { abort() { clearInterval(tickTimer); clearInterval(moveTimer); window.removeEventListener('keydown', onKey); } };
}
