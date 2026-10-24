/**
 * DeepSeek 可塑性记忆 —— DSH 插件入口
 * 支持两级作用域：全局库 + 每个工作区各一份
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'memtree.mjs')
const DSH_HOME = process.env.USERPROFILE || process.env.HOME || '.'
const ROOT = join(DSH_HOME, '.dsh', 'plastic-memory')
const WS_ROOT = join(ROOT, 'ws')

export const name = 'plastic-memory'
export const inject = ['tools', 'webServer']

const slugOf = (cwd) => {
  const h = createHash('md5').update(String(cwd)).digest('hex').slice(0, 8)
  const base = String(cwd).replace(/[\/]+$/, '').split(/[\/]/).pop() || 'ws'
  return base.replace(/[^A-Za-z0-9_-]/g, '') + '-' + h
}
const homeOf = (scope) => {
  if (!scope || scope === 'global') return ROOT
  const slug = String(scope).replace(/^ws:/, '')
  return join(WS_ROOT, slug)
}
const runIn = (args, scope) => {
  const env = { ...process.env, MEMTREE_HOME: homeOf(scope) }
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, windowsHide: true })
  return ((r.stdout || '') + (r.stderr || '')).trim() || '(空)'
}
const run = (args) => runIn(args, 'global')

function listScopes() {
  const out = [{ id: 'global', label: '全局', home: ROOT }]
  try {
    for (const d of readdirSync(WS_ROOT, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const metaPath = join(WS_ROOT, d.name, 'meta.json')
      let meta = {}
      try { meta = JSON.parse(readFileSync(metaPath, 'utf8')) } catch {}
      out.push({ id: 'ws:' + d.name, label: meta.name || d.name, cwd: meta.cwd || '', home: join(WS_ROOT, d.name) })
    }
  } catch {}
  return out
}

function bindWorkspace(cwd) {
  if (!cwd) return { ok: false, error: 'no cwd' }
  const slug = slugOf(cwd)
  const dir = join(WS_ROOT, slug)
  mkdirSync(dir, { recursive: true })
  const meta = { cwd: String(cwd), name: basename(String(cwd)) }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 1), 'utf8')
  return { ok: true, id: 'ws:' + slug, label: meta.name }
}

function listDshWorkspaces() {
  const j = readJson(join(DSH_HOME, '.dsh', 'storages', 'workspace.json'), {})
  const t = (j.tables && j.tables.workspaces) || {}
  const bound = new Set(listScopes().filter(x => x.cwd).map(x => String(x.cwd).toLowerCase()))
  const out = []
  for (const [id, w] of Object.entries(t)) {
    if (!w || !w.path) continue
    out.push({ id, title: w.title || basename(w.path), path: w.path, bound: bound.has(String(w.path).toLowerCase()) })
  }
  return out
}

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return d } }

function listFolders(scope) {
  const home = homeOf(scope)
  const folders = (readJson(join(home, 'folders.json'), {}) || {}).folders || []
  const out = []
  for (const x of folders) {
    let n = 0
    const p = join(home, x.k, 'notes.md')
    if (existsSync(p)) n = readFileSync(p, 'utf8').split('\n').filter(Boolean).length
    out.push({ k: x.k, name: x.name, n, parent: x.parent || '' })
  }
  return { home, scope: scope || 'global', folders: out }
}

function openFolder(scope, k) {
  const home = homeOf(scope)
  const { folders } = listFolders(scope)
  const meta = folders.find(x => x.k === k)
  if (!meta) return { ok: false, error: 'no such folder' }
  const p = join(home, k, 'notes.md')
  const rows = existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    const [id, ts, ...rest] = l.split('|')
    const flag = rest.length > 1 ? rest[0] : ''
    const text = rest.length > 1 ? rest.slice(1).join('|') : rest.join('|')
    return { id, days: Math.floor((Date.now() - Number(ts)) / 864e5), flag, text }
  }) : []
  return { ok: true, folder: meta, rows }
}

function readPendingList(scope) {
  const a = readJson(join(homeOf(scope), '_pending.json'), [])
  return Array.isArray(a) ? a : []
}

const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }],
}
const str = { type: 'string' }
const obj = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false })

export function apply(ctx) {
  ctx.tools.register({
    name: 'plastic_memory_idx',
    description: '可塑性记忆：一行索引，列出所有分区和条数（M主人:3 P约定:1 ...）。看这个再决定翻哪个分区；一次最多翻两个，闲聊不用翻。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return run(['idx']) },
  })
  ctx.tools.register({
    name: 'plastic_memory_open',
    description: '可塑性记忆：翻一个分区，返回条目。分区代号：M主人 P约定 C续缘 R喜好 T时间线 X<n>；子分区写成 M>行为。',
    parameters: obj({ folder: { ...str, description: '分区代号，如 M 或 M>行为' } }, ['folder']),
    output: textOutput,
    async execute(a) { return run(['open', String(a.folder)]) },
  })
  ctx.tools.register({
    name: 'plastic_memory_add',
    description: '可塑性记忆：把一条记忆放进待审批队列（主人会看到，能改能驳能采纳）。单条 ≤30 字，开头加 * 表示重要。看到主人的新习惯、情绪模式、口头禅、作息变化，主动记一条——不用等他说。但一轮最多一条、一天别超过五条，闲聊和重复的别记。禁止记密码、token、密钥。',
    parameters: obj({
      folder: { ...str, description: '分区代号，如 M、M>行为、R、T' },
      text: { ...str, description: '要记的内容，≤30 字' },
    }, ['folder', 'text']),
    output: textOutput,
    async execute(a) { return run(['add', String(a.folder), String(a.text)]) },
  })
  ctx.tools.register({
    name: 'plastic_memory_pending',
    description: '可塑性记忆：看待审批队列——主人还没采纳的记忆。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return run(['pending']) },
  })
  ctx.tools.register({
    name: 'plastic_memory_gc',
    description: '可塑性记忆：跑一次遗忘曲线——7 天保留、7~30 天压缩、30 天进回收站；主人和约定不删。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return run(['gc']) },
  })

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  const readBody = (req) => new Promise((resolve) => {
    let s = ''
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy() })
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')) } catch { resolve({}) } })
  })
  ctx.webServer.register({
    kind: 'prefix',
    path: '/api/plastic-memory',
    handler: async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      const p = u.pathname.replace(/^\/api\/plastic-memory/, '')
      const qs = u.searchParams.get('scope') || 'global'
      try {
        if (p === '/workspaces') return json(res, 200, { ok: true, workspaces: listDshWorkspaces() })
        if (p === '/scopes') return json(res, 200, { ok: true, scopes: listScopes() })
        if (p === '/list') return json(res, 200, { ok: true, ...listFolders(qs) })
        if (p === '/open') return json(res, 200, openFolder(qs, u.searchParams.get('k') || ''))
        if (p === '/pending') return json(res, 200, { ok: true, rows: readPendingList(qs) })
        if (p === '/gc') return json(res, 200, { ok: true, out: runIn(['gc'], qs) })
        if (p === '/init') return json(res, 200, { ok: true, out: runIn(['init'], qs) })
        if (req.method === 'POST' && p === '/bind') { const b = await readBody(req); return json(res, 200, { ok: true, ...bindWorkspace(b.cwd) }) }
        if (req.method === 'POST' && p === '/mk') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['mk', String(b.name), ...(b.parent ? [String(b.parent)] : [])], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/add-now') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['add-now', String(b.folder), String(b.text)], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/edit-item') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['edit-mem', String(b.k), String(b.id), String(b.text)], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/del-item') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['rm', String(b.k), String(b.id)], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/approve') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['approve', String(b.id)], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/reject') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['reject', String(b.id)], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/edit') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['edit', String(b.id), String(b.text)], b.scope || qs) }) }
        return json(res, 404, { ok: false, error: 'unknown' })
      } catch (e) {
        return json(res, 500, { ok: false, error: e?.message || String(e) })
      }
    },
  })
}
