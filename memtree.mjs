#!/usr/bin/env node
// 记忆树：按"子文件夹"分区记东西，带遗忘曲线
import fs from 'node:fs'
import path from 'node:path'
const HOME = process.env.MEMTREE_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'plastic-memory')
const TRASH = path.join(HOME, '_trash')
const MAX_FOLDERS = 15
const MAXLEN = 30
const DAY = 864e5
// 内置分区：M 主人(禁删) P 约定(禁删) C 续缘 R 喜好 T 时间线
const BUILTIN = [
  { k: 'M', name: '主人', guard: 1 },
  { k: 'P', name: '约定', guard: 1 },
  { k: 'C', name: '续缘' },
  { k: 'R', name: '喜好' },
  { k: 'T', name: '时间线' },
]
const NF = () => path.join(HOME, 'folders.json')
function load() {
  try { const j = JSON.parse(fs.readFileSync(NF(), 'utf8')); if (Array.isArray(j.folders)) return j } catch {}
  return { folders: BUILTIN.map(f => ({ ...f })) }
}
function save(s) { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(NF(), JSON.stringify(s, null, 1)) }
const dirOf = (k) => path.join(HOME, k)
const fileOf = (k) => path.join(dirOf(k), 'notes.md')
function readNotes(k) {
  const p = fileOf(k)
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => {
    const [id, ts, flag, ...rest] = l.split('|')
    return { id, ts: +ts, flag: flag || '', text: rest.join('|') }
  })
}
function writeNotes(k, rows) {
  fs.mkdirSync(dirOf(k), { recursive: true })
  fs.writeFileSync(fileOf(k), rows.map(r => [r.id, r.ts, r.flag, r.text].join('|')).join('\n') + (rows.length ? '\n' : ''))
}
const shortId = () => (Date.now() % 36 ** 4).toString(36).padStart(4, '0')
const txt = (s) => String(s || '').replace(/[\r\n|]+/g, ' ').trim()
const len = (s) => [...s].length
const S = load()
const find = (k) => {
  if (!k) return undefined
  const t = String(k).trim()
  const m = t.match(/^([A-Za-z0-9]+)>(.+)$/)
  if (m) {
    const p = S.folders.find(f => f.k === m[1] || f.name === m[1])
    if (p) return S.folders.find(f => f.parent === p.k && f.name === m[2].trim())
  }
  return S.folders.find(f => f.k === t || f.name === t)
}
function cmdIdx() {
  const out = []
  const tops = S.folders.filter(f => !f.parent)
  for (const f of tops) {
    out.push(`${f.k}${f.name}:${readNotes(f.k).length}`)
    for (const c of S.folders.filter(x => x.parent === f.k)) {
      out.push(`${f.k}>${c.name}:${readNotes(c.k).length}`)
    }
  }
  console.log(out.join(' '))
}
function cmdOpen(args) {
  const f = find(args[0])
  if (!f) return console.log('无此分区')
  const rows = readNotes(f.k)
  if (!rows.length) return console.log('空')
  const now = Date.now()
  for (const r of rows) {
    const d = Math.floor((now - r.ts) / DAY)
    console.log(`${r.id} ${d}d ${r.flag || '-'} ${r.text}`)
  }
}
// 待审批队列：模型/自动写入先落这里，等人点采纳
const PF = () => path.join(HOME, '_pending.json')
function readPending() {
  try { const a = JSON.parse(fs.readFileSync(PF(), 'utf8')); return Array.isArray(a) ? a : [] } catch { return [] }
}
function writePending(a) {
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(PF(), JSON.stringify(a, null, 1))
}
function commit(k, it) {
  const rows = readNotes(k)
  rows.push({ id: it.id || shortId(), ts: it.ts || Date.now(), flag: it.flag || '', text: it.text })
  writeNotes(k, rows)
  return rows.length
}
function cmdAdd(args, direct) {
  const f = find(args[0])
  if (!f) return console.log('无此分区：' + S.folders.map(x => x.k + x.name).join(' '))
  if (!f.parent && S.folders.some(x => x.parent === f.k)) return console.log('主分区只放子分区，写到子分区里（如 ' + f.k + '>某子分区）')
  const t = txt(args.slice(1).join(' '))
  if (!t) return console.log('空内容不记')
  if (len(t) > MAXLEN) return console.log(`太长(${len(t)}字)，压缩到 ${MAXLEN} 字内`)
  const imp = /^\*/.test(t) ? '*' : ''
  const clean = t.replace(/^\*/, '')
  if (direct) {
    if (readNotes(f.k).some(r => r.text === clean)) return console.log('已有')
    return console.log('ok ' + f.k + ':' + commit(f.k, { flag: imp, text: clean }))
  }
  const p = readPending()
  if (p.some(x => x.k === f.k && x.text === clean)) return console.log('已在待审里')
  p.push({ id: shortId(), k: f.k, text: clean, flag: imp, ts: Date.now() })
  writePending(p)
  console.log('待审 ' + p.length)
}
function cmdPending() {
  const p = readPending()
  if (!p.length) return console.log('空')
  const now = Date.now()
  for (const x of p) console.log(`${x.id} ${x.k}${x.flag ? ' *' : ''} ${Math.floor((now - x.ts) / 6e4)}m ${x.text}`)
}
function cmdApprove(args) {
  const p = readPending()
  const i = p.findIndex(x => x.id === args[0])
  if (i < 0) return console.log('无此条')
  const it = p[i]
  commit(it.k, it)
  p.splice(i, 1)
  writePending(p)
  console.log('采纳 ' + it.k + ' 剩' + p.length)
}
function cmdReject(args) {
  const p = readPending()
  const i = p.findIndex(x => x.id === args[0])
  if (i < 0) return console.log('无此条')
  p.splice(i, 1)
  writePending(p)
  console.log('驳回 剩' + p.length)
}
function cmdEdit(args) {
  const p = readPending()
  const i = p.findIndex(x => x.id === args[0])
  if (i < 0) return console.log('无此条')
  const t = txt(args.slice(1).join(' '))
  if (!t) return console.log('空内容')
  if (len(t) > MAXLEN) return console.log(`太长(${len(t)}字)`)
  p[i].text = t
  writePending(p)
  console.log('改好了')
}
function cmdDone(args) {
  const f = find(args[0]); if (!f) return console.log('无此分区')
  const rows = readNotes(f.k)
  const r = rows.find(x => x.id === args[1])
  if (!r) return console.log('无此条')
  r.flag = '✓'
  writeNotes(f.k, rows)
  console.log('done')
}
function trash(k, r, why) {
  fs.mkdirSync(TRASH, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  fs.appendFileSync(path.join(TRASH, day + '.md'), `${k}|${r.ts}|${r.flag || '-'}|${r.text}|${why}\n`)
}
function cmdRm(args) {
  const f = find(args[0]); if (!f) return console.log('无此分区')
  const rows = readNotes(f.k)
  const i = rows.findIndex(x => x.id === args[1])
  if (i < 0) return console.log('无此条')
  if (f.guard) return console.log('该分区禁删，只能标记完成或改内容')
  trash(f.k, rows[i], 'manual')
  rows.splice(i, 1)
  writeNotes(f.k, rows)
  console.log('rm ok')
}
const RULES = {
  M: { keepAll: 1 },
  P: { keepAll: 1, doneExpire: 30 },
  C: { oldKeep: 3 },
  R: { oldKeep: 8 },
  T: { oldKeep: 8 },
  X: { oldKeep: 8 },
}
function ruleOf(f) { return RULES[f.k] || RULES[f.k[0]] || RULES.X }
function cmdGc() {
  const now = Date.now()
  let gone = 0, kept = 0
  for (const f of S.folders) {
    const rows = readNotes(f.k)
    const r = ruleOf(f)
    const out = []
    for (const n of rows) {
      const age = (now - n.ts) / DAY
      const imp = n.flag === '*'
      if (f.guard && r.keepAll && !(r.doneExpire && n.flag === '✓' && age > r.doneExpire)) { out.push(n); kept++; continue }
      if (age > 30) { trash(f.k, n, 'expired'); gone++; continue }
      if (age > 7) {
        if (imp) { out.push(n); kept++; continue }
        const recent = rows.filter(x => (now - x.ts) / DAY <= 7).length
        if (out.length - recent >= (r.oldKeep || 8) - recent) { trash(f.k, n, 'compress'); gone++; continue }
        out.push(n); kept++; continue
      }
      out.push(n); kept++
    }
    writeNotes(f.k, out)
  }
  console.log(`gc kept:${kept} trash:${gone}`)
}
function cmdMk(args) {
  const name = txt(args[0] || '')
  const parentArg = txt(args[1] || '')
  if (!name) return console.log('用法: mk <名字> [父分区]')
  let parent = null
  if (parentArg) {
    parent = find(parentArg)
    if (!parent) return console.log('没有这个父分区')
    if (parent.parent) return console.log('最多两级，子分区不能再开子分区')
  }
  const tops = S.folders.filter(f => !f.parent)
  if (!parent && tops.length >= MAX_FOLDERS) return console.log('主分区已满' + MAX_FOLDERS + '个')
  const sameLevel = S.folders.filter(f => (f.parent || '') === (parent ? parent.k : ''))
  if (sameLevel.some(f => f.name === name)) return console.log('这一层已有同名')
  let k
  if (parent) k = parent.k + '-' + (S.folders.filter(f => f.parent === parent.k).length + 1)
  else k = 'X' + tops.filter(f => f.k.startsWith('X')).length
  S.folders.push(parent ? { k, name, parent: parent.k } : { k, name })
  save(S); fs.mkdirSync(dirOf(k), { recursive: true })
  console.log('ok ' + k + ' ' + (parent ? parent.name + ' / ' : '') + name)
}
function cmdInit() {
  fs.mkdirSync(HOME, { recursive: true })
  fs.mkdirSync(TRASH, { recursive: true })
  for (const f of S.folders) { fs.mkdirSync(dirOf(f.k), { recursive: true }); if (!fs.existsSync(fileOf(f.k))) writeNotes(f.k, []) }
  save(S)
  console.log('init ok ' + HOME)
}
const [cmd, ...args] = process.argv.slice(2)
const MAP = { idx: cmdIdx, open: cmdOpen, add: (a) => cmdAdd(a, false), 'add-now': (a) => cmdAdd(a, true), pending: cmdPending, approve: cmdApprove, reject: cmdReject, edit: cmdEdit, done: cmdDone, rm: cmdRm, gc: cmdGc, mk: cmdMk, init: cmdInit }
if (!MAP[cmd]) { console.log('用法: idx|open|add|add-now|pending|approve|reject|edit|done|rm|gc|mk|init'); process.exit(1) }
MAP[cmd](args)
