/**
 * 记忆星空（内置在可塑性记忆里）—— 宿主侧
 * 只读/回写 ~/.dsh/plastic-memory 的数据；页面在 public/sky 下，渲染全交给本地 Edge 的显卡。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync, rmSync, renameSync } from 'node:fs'
import { dirname, join, extname, resolve, basename } from 'node:path'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const ROOT = join(HOME, '.dsh', 'plastic-memory')
const WS_ROOT = join(ROOT, 'ws')
const KEEP_TOPS = new Set(['M', 'P', 'R']) // 主人 / 约定 / 喜好：本来就不进遗忘曲线
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) } catch { return d } }

const homeOf = (scope) => {
  if (!scope || scope === 'global') return ROOT
  const slug = String(scope).replace(/^ws:/, '').replace(/[^A-Za-z0-9_-]/g, '')
  return join(WS_ROOT, slug)
}

function listScopes() {
  const out = [{ id: 'global', label: '全局', cwd: '' }]
  try {
    for (const d of readdirSync(WS_ROOT, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue
      const meta = readJson(join(WS_ROOT, d.name, 'meta.json'), {})
      out.push({ id: 'ws:' + d.name, label: meta.name || d.name, cwd: meta.cwd || '' })
    }
  } catch {}
  return out
}

const readFolders = (home) => {
  const j = readJson(join(home, 'folders.json'), { folders: [] })
  return Array.isArray(j.folders) ? j.folders : []
}
const notesPath = (home, k) => join(home, k, 'notes.md')

function readNotes(home, k) {
  const p = notesPath(home, k)
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean).map((line) => {
    const [id, ts, flag, ...rest] = line.split('|')
    return { id: (id || '').replace(/^\uFEFF/, ''), ts: Number(ts) || 0, flag: flag || '', text: rest.join('|') }
  })
}

function writeNotes(home, k, rows) {
  const p = notesPath(home, k)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, rows.map((r) => [r.id, r.ts, r.flag, r.text].join('|')).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function topOf(k, folders) {
  let cur = folders.find((f) => f.k === k)
  let guard = 0
  for (let i = 0; cur && i < 8; i++) {
    guard++
    if (!cur.parent) break
    const next = folders.find((f) => f.k === cur.parent)
    if (!next) break
    cur = next
  }
  return cur
}

function snapshot(scope) {
  const home = homeOf(scope)
  const folders = readFolders(home)
  const now = Date.now()
  const nameOf = new Map(folders.map((f) => [f.k, f.name]))
  const memories = []

  for (const f of folders) {
    const top = topOf(f.k, folders)
    const keepByRule = !!top && KEEP_TOPS.has(top.k)
    const fixedByRule = keepByRule || !!(top && top.guard) || !!f.guard
    for (const n of readNotes(home, f.k)) {
      const days = Math.max(0, Math.floor((now - n.ts) / 864e5))
      const manual = n.flag === '*' || n.flag === '✓'
      const pinned = manual || fixedByRule
      memories.push({
        id: n.id,
        folder: f.k,
        folderName: f.name,
        parent: f.parent || '',
        mainName: f.parent ? (nameOf.get(f.parent) || '') : f.name,
        text: n.text,
        flag: n.flag,
        pinned,
        autoFixed: fixedByRule && !manual,
        ts: n.ts,
        days,
        state: pinned ? 'fixed' : days >= 30 ? 'forgotten' : days >= 7 ? 'fading' : 'fresh',
      })
    }
  }

  return {
    scope: scope || 'global',
    folders: folders.map((f) => ({ k: f.k, name: f.name, parent: f.parent || '', guard: !!f.guard })),
    memories,
    pending: (readJson(join(home, '_pending.json'), []) || []).length,
    at: now,
  }
}

function saveMemory(scope, folder, id, text) {
  const home = homeOf(scope)
  const rows = readNotes(home, folder)
  const row = rows.find((r) => r.id === id)
  if (!row) return { ok: false, error: '没有这条记忆' }
  const body = String(text || '').replace(/[\r\n|]+/g, ' ').trim()
  if (!body) return { ok: false, error: '内容不能空' }
  row.text = body
  writeNotes(home, folder, rows)
  return { ok: true }
}

function deleteMemory(scope, folder, id) {
  const home = homeOf(scope)
  const rows = readNotes(home, folder)
  const i = rows.findIndex((r) => r.id === id)
  if (i < 0) return { ok: false, error: '没有这条记忆' }
  try {
    mkdirSync(join(home, '_trash'), { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    appendFileSync(join(home, '_trash', day + '.md'), `${folder}|${rows[i].ts}|${rows[i].flag || '-'}|${rows[i].text}|sky-delete\n`, 'utf8')
  } catch {}
  rows.splice(i, 1)
  writeNotes(home, folder, rows)
  return { ok: true }
}

function pinMemory(scope, folder, id, pinned) {
  const home = homeOf(scope)
  const rows = readNotes(home, folder)
  const row = rows.find((r) => r.id === id)
  if (!row) return { ok: false, error: '没有这条记忆' }
  row.flag = pinned ? '*' : ''
  writeNotes(home, folder, rows)
  return { ok: true }
}

function deleteFolder(scope, k) {
  const home = homeOf(scope)
  const j = readJson(join(home, 'folders.json'), { folders: [] })
  const folders = Array.isArray(j.folders) ? j.folders : []
  const target = folders.find((f) => f.k === k)
  if (!target) return { ok: false, error: '没有这个分区' }
  const all = [target, ...folders.filter((f) => f.parent === k)]
  const sink = join(home, '_trash')
  mkdirSync(sink, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  const file = join(sink, day + '.md')
  let moved = 0
  for (const f of all) {
    const rows = readNotes(home, f.k)
    if (rows.length) {
      const head = '\n## 删除分区 ' + f.name + '（' + f.k + '） ' + new Date().toISOString() + '\n'
      appendFileSync(file, head + rows.map((r) => f.k + '|' + r.ts + '|' + (r.flag || '-') + '|' + r.text + '|rm-folder').join('\n') + '\n', 'utf8')
      moved += rows.length
    }
    try { rmSync(join(home, f.k), { recursive: true, force: true }) } catch {}
  }
  const gone = new Set(all.map((f) => f.k))
  j.folders = folders.filter((f) => !gone.has(f.k))
  writeFileSync(join(home, 'folders.json'), JSON.stringify(j, null, 1), 'utf8')
  return { ok: true, k, removed: all.length, moved }
}

function deleteScope(scope) {
  const id = String(scope || '')
  if (!id.startsWith('ws:')) return { ok: false, error: '全局记忆库不能删' }
  const slug = id.slice(3).replace(/[^A-Za-z0-9_-]/g, '')
  const target = join(WS_ROOT, slug)
  if (!existsSync(target)) return { ok: false, error: '没有这个工作区' }
  const bin = join(WS_ROOT, '.deleted')
  mkdirSync(bin, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19)
  renameSync(target, join(bin, slug + '-' + stamp))
  return { ok: true, scope: id }
}

function renameFolder(scope, k, name) {
  const home = homeOf(scope)
  const clean = String(name || '').replace(/[\r\n|]/g, ' ').trim()
  if (!clean) return { ok: false, error: '名字不能空' }
  const j = readJson(join(home, 'folders.json'), { folders: [] })
  const f = (j.folders || []).find((x) => x.k === k)
  if (!f) return { ok: false, error: '没有这个分区' }
  f.name = clean
  writeFileSync(join(home, 'folders.json'), JSON.stringify(j, null, 1), 'utf8')
  return { ok: true }
}

const edgeInfo = () => {
  const path = EDGE_CANDIDATES.find((p) => existsSync(p))
  return path ? { found: true, path } : { found: false, path: '' }
}

function openInEdge(url) {
  const info = edgeInfo()
  if (!info.found) return { ok: false, error: '没找到 Edge' }
  try {
    const child = spawn(info.path, ['--new-window', url], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    return { ok: true, url }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

function installEdge() {
  return new Promise((resolvePromise) => {
    let out = ''
    let child
    try {
      child = spawn('winget', ['install', '--id', 'Microsoft.Edge', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements'], { windowsHide: true })
    } catch (e) {
      resolvePromise({ ok: false, error: '找不到 winget', out: String(e?.message || e) })
      return
    }
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    child.on('error', (e) => resolvePromise({ ok: false, error: e?.message || String(e), out }))
    child.on('close', () => resolvePromise({ ok: edgeInfo().found, out: out.split(/\r?\n/).filter(Boolean).slice(-6).join('\n') }))
    setTimeout(() => { try { child.kill() } catch {} }, 180000)
  })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

export function registerSky(ctx, publicRoot) {
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const readBody = (req) => new Promise((resolvePromise) => {
    let s = ''
    req.on('data', (c) => { s += c; if (s.length > 2e6) req.destroy() })
    req.on('end', () => { try { resolvePromise(JSON.parse(s || '{}')) } catch { resolvePromise({}) } })
  })

  ctx.webServer.register({
    kind: 'prefix',
    path: '/api/memory-sky',
    handler: async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      const p = u.pathname.replace(/^\/api\/memory-sky/, '') || '/'
      const scope = u.searchParams.get('scope') || 'global'
      try {
        if (req.method === 'GET' && p === '/data') return json(res, 200, { ok: true, ...snapshot(scope) })
        if (req.method === 'GET' && p === '/scopes') return json(res, 200, { ok: true, scopes: listScopes() })
        if (req.method === 'GET' && p === '/env') return json(res, 200, { ok: true, edge: edgeInfo(), node: process.versions.node })
        if (req.method === 'POST' && p === '/env/fix') {
          const before = edgeInfo()
          if (before.found) return json(res, 200, { ok: true, already: true, edge: before })
          const r = await installEdge()
          return json(res, 200, { ok: r.ok, out: r.out || r.error || '', edge: edgeInfo() })
        }
        if (req.method === 'POST' && p === '/open') {
          const host = req.headers.host || '127.0.0.1'
          return json(res, 200, openInEdge(`http://${host}/api/memory-sky/?scope=${encodeURIComponent(scope)}`))
        }
        if (req.method === 'POST' && p === '/save') {
          const b = await readBody(req)
          return json(res, 200, saveMemory(b.scope || scope, String(b.folder), String(b.id), b.text))
        }
        if (req.method === 'POST' && p === '/del') {
          const b = await readBody(req)
          return json(res, 200, deleteMemory(b.scope || scope, String(b.folder), String(b.id)))
        }
        if (req.method === 'POST' && p === '/pin') {
          const b = await readBody(req)
          return json(res, 200, pinMemory(b.scope || scope, String(b.folder), String(b.id), !!b.pinned))
        }
        if (req.method === 'POST' && p === '/folder') {
          const b = await readBody(req)
          return json(res, 200, renameFolder(b.scope || scope, String(b.k), b.name))
        }
        if (req.method === 'POST' && p === '/folder/rm') {
          const b = await readBody(req)
          return json(res, 200, deleteFolder(b.scope || scope, String(b.k)))
        }
        if (p === '/classify' && req.method === 'GET') {
          const task = readJson(join(homeOf('global'), '_classify.json'), null)
          return json(res, 200, { ok: true, pending: !!task, at: (task && task.at) || 0 })
        }
        if (p === '/classify' && req.method === 'POST') {
          const home = homeOf('global')
          mkdirSync(home, { recursive: true })
          writeFileSync(join(home, '_classify.json'), JSON.stringify({ at: Date.now() }, null, 1), 'utf8')
          return json(res, 200, { ok: true })
        }
        if (p === '/classify/cancel' && req.method === 'POST') {
          try { rmSync(join(homeOf('global'), '_classify.json'), { force: true }) } catch {}
          return json(res, 200, { ok: true })
        }
        if (req.method === 'POST' && p === '/scope/rm') {
          const b = await readBody(req)
          return json(res, 200, deleteScope(b.scope))
        }

        const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '')
        const file = resolve(publicRoot, rel)
        if (!file.startsWith(resolve(publicRoot))) return json(res, 403, { ok: false, error: 'forbidden' })
        if (!existsSync(file)) return json(res, 404, { ok: false, error: 'not found' })
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(readFileSync(file))
      } catch (e) {
        return json(res, 500, { ok: false, error: e?.message || String(e) })
      }
    },
  })
}

export { basename }
