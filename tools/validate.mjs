#!/usr/bin/env node
// Validate Zombie60 content files against docs/CONTENT_GUIDE.md.
// Usage: node tools/validate.mjs [file ...]   (no args = everything in data/manifest.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/world.json'), 'utf8'));
const chars = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/characters.json'), 'utf8'));

const LOC = new Set(world.locations.map(l => l.id));
const CHAR = new Set(chars.map(c => c.id));
const HEROINE = new Set(chars.filter(c => !c.isPlayer).map(c => c.id));
const FACTION = new Set(world.factions.map(f => f.id));
const WEATHER = new Set(Object.keys(world.weather));
const RES = new Set(['Food', 'Water', 'Med', 'Ammo', 'Parts', 'Morale', 'Noise', 'ExploreRisk', 'Defense']);
const STATUS = new Set(['Health', 'Stress', 'Infection', 'Body']);
const REL = new Set(['Affection', 'Trust']);
const STAT = new Set(['STR', 'LOG', 'CHA', 'COM']);
const OPS = new Set(['gte', 'lte', 'gt', 'lt', 'eq']);
const POOLS = new Set(['shelter', 'romance', 'world', 'story', 'queued']);
const EVENT_KEYS = new Set(['id', 'pool', 'title', 'weight', 'once', 'conditions', 'text', 'choices']);
const CHOICE_KEYS = new Set(['label', 'requires', 'cost', 'check', 'outcomes']);
const COND_KEYS = new Set(['minDay', 'maxDay', 'flags', 'notFlags', 'resources', 'chars', 'anyChar', 'factions', 'weather', 'density', 'chance']);
const EFFECT_KEYS = new Set(['resources', 'status', 'chars', 'relations', 'factions', 'flagsSet', 'flagsClear', 'discover', 'queue', 'world', 'kill', 'rescue', 'end']);

let files = process.argv.slice(2);
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/manifest.json'), 'utf8')); } catch {}
if (!files.length) {
  if (!manifest) { console.error('no files given and no data/manifest.json'); process.exit(2); }
  files = manifest.content.map(f => path.join('data', f));
}

let endings = new Set();
try { endings = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/endings.json'), 'utf8')).map(e => e.id)); } catch {}

const errors = [];
const warns = [];
const allIds = new Map();
const queuedRefs = [];

function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }

function checkCmp(where, v) {
  if (typeof v === 'number' || typeof v === 'boolean') return;
  if (!isObj(v)) return errors.push(`${where}: comparator must be object like {"gte":3}`);
  for (const k of Object.keys(v)) {
    if (!OPS.has(k)) errors.push(`${where}: unknown operator "${k}"`);
    else if (typeof v[k] !== 'number') errors.push(`${where}.${k}: must be number`);
  }
}

function checkCond(where, c) {
  if (!isObj(c)) return errors.push(`${where}: must be object`);
  for (const k of Object.keys(c)) if (!COND_KEYS.has(k)) errors.push(`${where}: unknown key "${k}"`);
  for (const k of ['flags', 'notFlags']) if (c[k] !== undefined && !Array.isArray(c[k])) errors.push(`${where}.${k}: must be array`);
  for (const k of ['minDay', 'maxDay', 'chance']) if (c[k] !== undefined && typeof c[k] !== 'number') errors.push(`${where}.${k}: must be number`);
  if (c.resources) for (const [r, v] of Object.entries(c.resources)) { if (!RES.has(r)) errors.push(`${where}.resources: unknown resource "${r}"`); checkCmp(`${where}.resources.${r}`, v); }
  if (c.chars) for (const [id, spec] of Object.entries(c.chars)) {
    if (!CHAR.has(id)) errors.push(`${where}.chars: unknown character "${id}"`);
    for (const [k, v] of Object.entries(spec)) {
      if (['alive', 'present', 'missing'].includes(k)) { if (typeof v !== 'boolean') errors.push(`${where}.chars.${id}.${k}: must be boolean`); }
      else if (STATUS.has(k) || REL.has(k)) checkCmp(`${where}.chars.${id}.${k}`, v);
      else errors.push(`${where}.chars.${id}: unknown key "${k}"`);
    }
  }
  if (c.anyChar) for (const [k, v] of Object.entries(c.anyChar)) { if (!STATUS.has(k) && !REL.has(k)) errors.push(`${where}.anyChar: unknown key "${k}"`); checkCmp(`${where}.anyChar.${k}`, v); }
  if (c.factions) for (const [f, v] of Object.entries(c.factions)) { if (!FACTION.has(f)) errors.push(`${where}.factions: unknown faction "${f}"`); checkCmp(`${where}.factions.${f}`, v); }
  if (c.weather) { if (!Array.isArray(c.weather)) errors.push(`${where}.weather: must be array`); else for (const w of c.weather) if (!WEATHER.has(w)) errors.push(`${where}.weather: unknown "${w}"`); }
  if (c.density) for (const [l, v] of Object.entries(c.density)) { if (!LOC.has(l)) errors.push(`${where}.density: unknown location "${l}"`); checkCmp(`${where}.density.${l}`, v); }
}

function charRef(where, id, { heroineOnly = false } = {}) {
  if (id === '$actor' || id === '$target') return;
  if (!CHAR.has(id)) errors.push(`${where}: unknown character "${id}"`);
  else if (heroineOnly && !HEROINE.has(id)) errors.push(`${where}: relations only apply to heroines, not "${id}"`);
}

function checkEffects(where, e) {
  if (!isObj(e)) return errors.push(`${where}: must be object`);
  for (const k of Object.keys(e)) if (!EFFECT_KEYS.has(k)) errors.push(`${where}: unknown key "${k}"`);
  if (e.resources) for (const [r, v] of Object.entries(e.resources)) { if (!RES.has(r)) errors.push(`${where}.resources: unknown resource "${r}"`); if (!Number.isInteger(v)) errors.push(`${where}.resources.${r}: must be integer`); }
  if (e.status) for (const [k, v] of Object.entries(e.status)) { if (!STATUS.has(k)) errors.push(`${where}.status: unknown "${k}" (Affection/Trust go in relations)`); if (!Number.isInteger(v)) errors.push(`${where}.status.${k}: must be integer`); }
  if (e.chars) for (const [id, d] of Object.entries(e.chars)) { charRef(`${where}.chars`, id); for (const [k, v] of Object.entries(d)) { if (!STATUS.has(k)) errors.push(`${where}.chars.${id}: unknown "${k}"`); if (!Number.isInteger(v)) errors.push(`${where}.chars.${id}.${k}: must be integer`); } }
  if (e.relations) for (const [id, d] of Object.entries(e.relations)) { charRef(`${where}.relations`, id, { heroineOnly: true }); for (const [k, v] of Object.entries(d)) { if (!REL.has(k)) errors.push(`${where}.relations.${id}: unknown "${k}"`); if (!Number.isInteger(v)) errors.push(`${where}.relations.${id}.${k}: must be integer`); } }
  if (e.factions) for (const [f, v] of Object.entries(e.factions)) { if (!FACTION.has(f)) errors.push(`${where}.factions: unknown "${f}"`); if (!Number.isInteger(v)) errors.push(`${where}.factions.${f}: must be integer`); }
  for (const k of ['flagsSet', 'flagsClear', 'discover', 'kill', 'rescue']) if (e[k] !== undefined && !Array.isArray(e[k])) errors.push(`${where}.${k}: must be array`);
  if (e.discover) for (const l of e.discover) if (!LOC.has(l)) errors.push(`${where}.discover: unknown location "${l}"`);
  for (const k of ['kill', 'rescue']) if (e[k]) for (const id of e[k]) charRef(`${where}.${k}`, id);
  if (e.queue) { if (!Array.isArray(e.queue)) errors.push(`${where}.queue: must be array`); else for (const q of e.queue) { if (!q.id || typeof q.inDays !== 'number') errors.push(`${where}.queue: entries need {id, inDays}`); else queuedRefs.push([where, q.id]); } }
  if (e.world) {
    for (const k of Object.keys(e.world)) if (!['density', 'horde'].includes(k)) errors.push(`${where}.world: unknown key "${k}"`);
    if (e.world.density) for (const l of Object.keys(e.world.density)) if (!LOC.has(l)) errors.push(`${where}.world.density: unknown location "${l}"`);
    if (e.world.horde && (!LOC.has(e.world.horde.at) || typeof e.world.horde.size !== 'number')) errors.push(`${where}.world.horde: needs {at: <location>, size: number}`);
  }
  if (e.end !== undefined && endings.size && !endings.has(e.end)) errors.push(`${where}.end: unknown ending "${e.end}"`);
}

function checkEvent(file, ev, i) {
  const where = `${file}#${ev?.id || i}`;
  if (!isObj(ev)) return errors.push(`${where}: event must be object`);
  for (const k of Object.keys(ev)) if (!EVENT_KEYS.has(k)) errors.push(`${where}: unknown key "${k}"`);
  for (const k of ['id', 'pool', 'title', 'text']) if (typeof ev[k] !== 'string' || !ev[k]) errors.push(`${where}: missing ${k}`);
  if (ev.id) { if (allIds.has(ev.id)) errors.push(`${where}: duplicate id (also in ${allIds.get(ev.id)})`); allIds.set(ev.id, file); }
  if (ev.pool && !POOLS.has(ev.pool) && !(ev.pool.startsWith('loc:') && LOC.has(ev.pool.slice(4)) && ev.pool !== 'loc:home')) errors.push(`${where}: bad pool "${ev.pool}"`);
  if (ev.pool === 'story' && (!ev.conditions || ev.once !== true)) errors.push(`${where}: story events need conditions and once:true`);
  if (ev.conditions) checkCond(`${where}.conditions`, ev.conditions);
  if (/沈硯(說|道|笑|皺眉|點頭)/.test(ev.text || '')) warns.push(`${where}: player is "你", don't narrate 沈硯 in third person`);
  if (!Array.isArray(ev.choices) || ev.choices.length < 2 || ev.choices.length > 4) errors.push(`${where}: choices must be 2–4`);
  (ev.choices || []).forEach((ch, j) => {
    const cw = `${where}.choices[${j}]`;
    if (!isObj(ch)) return errors.push(`${cw}: must be object`);
    for (const k of Object.keys(ch)) if (!CHOICE_KEYS.has(k)) errors.push(`${cw}: unknown key "${k}"`);
    if (typeof ch.label !== 'string' || !ch.label) errors.push(`${cw}: missing label`);
    if (ch.requires) checkCond(`${cw}.requires`, ch.requires);
    if (ch.cost) {
      for (const [r, v] of Object.entries(ch.cost)) { if (!RES.has(r)) errors.push(`${cw}.cost: unknown resource "${r}"`); if (!Number.isInteger(v)) errors.push(`${cw}.cost.${r}: must be integer`); }
      for (const [r, v] of Object.entries(ch.cost)) if (v > 0 && ['Food', 'Water', 'Med', 'Ammo', 'Parts'].includes(r) && !ch.requires?.resources?.[r]) warns.push(`${cw}: cost ${r} without requires.resources.${r}`);
    }
    if (ch.check) {
      const c = ch.check;
      if (!STAT.has(c.stat)) errors.push(`${cw}.check: bad stat "${c.stat}"`);
      if (typeof c.dc !== 'number') errors.push(`${cw}.check: dc must be number`);
      if (!(c.who === 'actor' || c.who === 'best' || CHAR.has(c.who))) errors.push(`${cw}.check: bad who "${c.who}"`);
      if (!ch.outcomes?.success || !ch.outcomes?.fail) errors.push(`${cw}: check needs outcomes.success and outcomes.fail`);
    } else if (ch.outcomes && !ch.outcomes.always) errors.push(`${cw}: no check → needs outcomes.always`);
    if (!isObj(ch.outcomes)) return errors.push(`${cw}: missing outcomes`);
    for (const [ok, out] of Object.entries(ch.outcomes)) {
      if (!['success', 'fail', 'always'].includes(ok)) { errors.push(`${cw}.outcomes: unknown "${ok}"`); continue; }
      if (!isObj(out)) { errors.push(`${cw}.outcomes.${ok}: must be object`); continue; }
      for (const k of Object.keys(out)) if (!['text', 'effects'].includes(k)) errors.push(`${cw}.outcomes.${ok}: unknown key "${k}"`);
      if (out.effects) checkEffects(`${cw}.outcomes.${ok}.effects`, out.effects);
    }
  });
}

const quests = [];
for (const f of files) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8')); }
  catch (e) { errors.push(`${f}: ${e.message}`); continue; }
  const evs = Array.isArray(data) ? data : data.events;
  if (!Array.isArray(evs)) { errors.push(`${f}: needs {"events": [...]}`); continue; }
  evs.forEach((ev, i) => checkEvent(path.basename(f), ev, i));
  for (const q of (data.quests || [])) {
    if (!q.id || !q.title || !Array.isArray(q.stages) || !q.stages.length) errors.push(`${f}: quest needs id, title, stages[]`);
    quests.push(q);
  }
}

// Cross-file checks only make sense when validating the full set.
const full = process.argv.length <= 2;
for (const [where, id] of queuedRefs) if (!allIds.has(id) && full) errors.push(`${where}.queue: event "${id}" not found`);
for (const [where, id] of queuedRefs) if (!allIds.has(id) && !full) warns.push(`${where}.queue: "${id}" not in given files`);

for (const w of warns) console.log('WARN ', w);
for (const e of errors) console.log('ERROR', e);
console.log(`\n${allIds.size} events, ${quests.length} quests, ${errors.length} errors, ${warns.length} warnings`);
process.exit(errors.length ? 1 : 0);
