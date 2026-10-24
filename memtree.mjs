#!/usr/bin/env node
// 记忆树：按"子文件夹"分区记东西，带遗忘曲线
import fs from 'node:fs'
import path from 'node:path'
const HOME = process.env.MEMTREE_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'plastic-memory')
const TRASH = path.join(HOME, '_trash')
const MAX_FOLDERS = 15
const BACKUPS = path.join(HOME, '_backups')
const KEEP_BACKUPS = 10
const SOFTLEN = 60 // 只是提示，不拦
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
  const all = args.includes('--all')
  const rows = readNotes(f.k)
  if (!rows.length) return console.log('空')
  const now = Date.now()
  const show = all ? rows : rows.slice(-20)
  if (!all && rows.length > 20) console.log(`（只给最近 20 条，共 ${rows.length} 条，要看全加 --all）`)
  for (const r of show) {
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
function commit(k, it, preRows) {
  const rows = preRows || readNotes(k)
  rows.push({ id: it.id || shortId(), ts: it.ts || Date.now(), flag: it.flag || '', text: it.text })
  writeNotes(k, rows)
  return rows.length
}
function cmdAdd(args) {
  const f = find(args[0])
  if (!f) return console.log('无此分区：' + S.folders.map(x => x.k + x.name).join(' '))
  if (!f.parent && S.folders.some(x => x.parent === f.k)) return console.log('主分区只放子分区，写到子分区里（如 ' + f.k + '>某子分区）')
  const t = txt(args.slice(1).join(' '))
  if (!t) return console.log('空内容不记')
  if (len(t) > SOFTLEN) console.log(`偏长(${len(t)}字)，能短点更好`)
  const imp = /^\*/.test(t) ? '*' : ''
  const clean = t.replace(/^\*/, '')
  const p = readPending()
  if (p.some(x => x.k === f.k && x.text === clean)) return console.log('已在待审里')
  p.push({ id: shortId(), k: f.k, text: clean, flag: imp, ts: Date.now() })
  writePending(p)
  console.log('待审 ' + p.length)
}
function cmdEditMem(args) {
  const f = find(args[0]); if (!f) return console.log('无此分区')
  const rows = readNotes(f.k)
  const r = rows.find(x => x.id === args[1]); if (!r) return console.log('无此条')
  const t = txt(args.slice(2).join(' '))
  if (!t) return console.log('空内容')
  r.text = t
  writeNotes(f.k, rows)
  console.log('改好了')
}
// 时间线：一天一条，新的往当天那条后面并，不一条消息一条
function cmdTLog(args) {
  const f = S.folders.find(x => x.k === 'T') || find('时间线')
  if (!f) return console.log('没有时间线分区')
  const line = txt(args.join(' '))
  if (!line) return console.log('要说点啥')
  const rows = readNotes(f.k)
  const today = new Date().toDateString()
  const i = rows.findIndex(r => new Date(r.ts).toDateString() === today)
  if (i >= 0) {
    const merged = rows[i].text + '｜' + line
    rows[i].text = merged.length > 300 ? rows[i].text : merged
    rows[i].ts = Date.now()
    writeNotes(f.k, rows)
    return console.log('ok 并进今天那条')
  }
  writeNotes(f.k, rows.concat([{ id: shortId(), ts: Date.now(), flag: '', text: line }]))
  console.log('ok 今天第一条')
}
function cmdSearch(args) {
  const q = txt(args.join(' ')).toLowerCase()
  if (!q) return console.log('给个关键词')
  const hits = []
  for (const f of S.folders) {
    const tag = f.parent ? f.parent + '>' + f.name : f.k + f.name
    for (const r of readNotes(f.k)) {
      if ((r.text || '').toLowerCase().includes(q)) hits.push(tag + ' ' + r.id + ' ' + (r.flag ? r.flag + ' ' : '') + r.text)
    }
  }
  for (const x of readPending()) {
    if ((x.text || '').toLowerCase().includes(q)) hits.push('待审 ' + x.id + ' ' + x.text)
  }
  console.log(hits.length ? hits.join(String.fromCharCode(10)) : '没找到')
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
  if (f.guard && args[2] !== 'force') return console.log('该分区默认禁删，界面手动删要带 force')
  trash(f.k, rows[i], 'manual')
  rows.splice(i, 1)
  writeNotes(f.k, rows)
  console.log('rm ok')
}
const RULES = {
  M: { keepAll: 1 },          // 主人、以及主人下面所有子分区：只由主人手删
  P: { keepAll: 1, doneExpire: 30 }, // 约定：全留，完成的过 30 天才清
  C: { oldKeep: 5 },          // 续缘：老的自然淡掉
  R: { keepAll: 1 },          // 喜好：只由主人手删
  T: { oldKeep: 10 },         // 时间线
  X: { oldKeep: 10 },         // 自定义
}
function ruleOf(f) {
  if (f.parent) return RULES[f.parent] || RULES.X
  return RULES[f.k] || RULES[f.k[0]] || RULES.X
}
function pruneBackups(keep = KEEP_BACKUPS) {
  if (!fs.existsSync(BACKUPS)) return
  const dirs = fs.readdirSync(BACKUPS).filter(d => {
    try { return fs.statSync(path.join(BACKUPS, d)).isDirectory() } catch { return false }
  }).sort()
  while (dirs.length > keep) fs.rmSync(path.join(BACKUPS, dirs.shift()), { recursive: true, force: true })
}
function snapshot(tag = 'gc') {
  const stamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19)
  const name = tag + '-' + stamp
  const dir = path.join(BACKUPS, name)
  fs.mkdirSync(dir, { recursive: true })
  const counts = {}
  for (const f of S.folders) {
    counts[f.k] = readNotes(f.k).length
    const src = fileOf(f.k)
    if (!fs.existsSync(src)) continue
    fs.mkdirSync(path.join(dir, f.k), { recursive: true })
    fs.copyFileSync(src, path.join(dir, f.k, 'notes.md'))
  }
  fs.writeFileSync(path.join(dir, 'folders.json'), JSON.stringify(S, null, 1))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ name, tag, at: Date.now(), counts }, null, 1))
  pruneBackups()
  return name
}
function cmdBackups() {
  if (!fs.existsSync(BACKUPS)) return console.log('还没有备份')
  const dirs = fs.readdirSync(BACKUPS).sort().reverse()
  if (!dirs.length) return console.log('还没有备份')
  for (const d of dirs) {
    let m = null
    try { m = JSON.parse(fs.readFileSync(path.join(BACKUPS, d, 'meta.json'), 'utf8')) } catch {}
    const total = m ? Object.values(m.counts || {}).reduce((a, b) => a + b, 0) : '?'
    console.log(d + '  ' + total + ' 条  ' + (m ? new Date(m.at).toLocaleString('zh-CN') : ''))
  }
}
function cmdRestore(args) {
  if (!fs.existsSync(BACKUPS)) return console.log('还没有备份')
  const want = txt(args[0] || '')
  const pick = want || (fs.readdirSync(BACKUPS).sort().reverse()[0] || '')
  if (!pick) return console.log('还没有备份')
  const dir = path.join(BACKUPS, pick)
  if (!fs.existsSync(dir)) return console.log('没有这个备份: ' + pick)
  let bk
  try { bk = JSON.parse(fs.readFileSync(path.join(dir, 'folders.json'), 'utf8')) } catch { return console.log('这个备份坏了: ' + pick) }
  const guard = snapshot('pre-restore') // 恢复前把当前状态也存一份，反悔还有退路
  for (const f of S.folders) {
    const p = fileOf(f.k)
    if (fs.existsSync(p)) fs.rmSync(p)
  }
  fs.writeFileSync(NF(), JSON.stringify(bk, null, 1))
  for (const f of (bk.folders || [])) {
    const src = path.join(dir, f.k, 'notes.md')
    if (!fs.existsSync(src)) continue
    fs.mkdirSync(dirOf(f.k), { recursive: true })
    fs.copyFileSync(src, fileOf(f.k))
  }
  console.log('restore ok ' + pick)
  console.log('恢复前的状态也存了一份: ' + guard)
}
function cmdGc() {
  const bk = snapshot('gc') // 先备份，再跑
  const now = Date.now()
  let gone = 0, kept = 0
  for (const f of S.folders) {
    const rows = readNotes(f.k)
    const r = ruleOf(f)
    const out = []
    for (const n of rows) {
      const age = (now - n.ts) / DAY
      const imp = n.flag === '*'
      if (r.keepAll && !(r.doneExpire && n.flag === '✓' && age > r.doneExpire)) { out.push(n); kept++; continue }
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
  if (!gone) {
    fs.rmSync(path.join(BACKUPS, bk), { recursive: true, force: true })
    console.log(`gc kept:${kept} trash:0`)
    console.log('没有东西要清，这次不留备份')
    return
  }
  console.log(`gc kept:${kept} trash:${gone}`)
  console.log('备份: ' + bk)
  console.log('不满意就还原: restore ' + bk)
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
const MAP = { idx: cmdIdx, open: cmdOpen, add: (a) => cmdAdd(a, false), 'edit-mem': cmdEditMem, search: cmdSearch, tlog: cmdTLog, pending: cmdPending, approve: cmdApprove, reject: cmdReject, edit: cmdEdit, done: cmdDone, rm: cmdRm, gc: cmdGc, mk: cmdMk, init: cmdInit, backups: cmdBackups, restore: cmdRestore }
if (!MAP[cmd]) { console.log('用法: idx|open|add|pending|approve|reject|edit|done|rm|gc|backups|restore|mk|init'); process.exit(1) }
MAP[cmd](args)
