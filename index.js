/**
 * DeepSeek 可塑性记忆 —— DSH 插件入口
 * 1) 把 memtree.mjs 的命令注册成 DSH 工具
 * 2) 给设置页/顶部栏提供只读浏览接口 /api/plastic-memory/*
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'memtree.mjs')

export const name = 'plastic-memory'
export const inject = ['tools', 'webServer']

const run = (args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', windowsHide: true })
  return ((r.stdout || '') + (r.stderr || '')).trim() || '(空)'
}
const str = { type: 'string' }
const obj = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false })

// ---------- 记忆库读取（给 UI 用，纯只读 + gc） ----------

function listFolders() {
  const home = process.env.MEMTREE_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'plastic-memory')
  const out = []
  const f = join(home, 'folders.json')
  let folders = []
  try { folders = JSON.parse(readFileSync(f, 'utf8')).folders || [] } catch {}
  for (const x of folders) {
    let n = 0
    const p = join(home, x.k, 'notes.md')
    if (existsSync(p)) n = readFileSync(p, 'utf8').split('\n').filter(Boolean).length
    out.push({ k: x.k, name: x.name, n, parent: x.parent || '' })
  }
  return { home, folders: out }
}

function openFolder(k) {
  const { home, folders } = listFolders()
  const meta = folders.find(x => x.k === k)
  if (!meta) return { ok: false, error: 'no such folder' }
  const p = join(home, k, 'notes.md')
  const rows = existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    const [id, ts, flag, ...rest] = l.split('|')
    return { id, days: Math.floor((Date.now() - Number(ts)) / 864e5), flag: flag || '', text: rest.join('|') }
  }) : []
  return { ok: true, folder: meta, rows }
}

// 宿主 tools.register 要求每个工具声明 output（schema + render），否则插件整个不激活
const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }],
}

export function apply(ctx) {
  // ---- DSH 工具 ----
  ctx.tools.register({
    name: 'plastic_memory_idx',
    description: '可塑性记忆：一行索引，列出所有分区和条数（M主人:3 P约定:1 ...）。看这个再决定翻哪个分区，别整库乱翻。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return run(['idx']) },
  })
  ctx.tools.register({
    name: 'plastic_memory_open',
    description: '可塑性记忆：翻一个分区，返回条目（id 天数 标记 内容）。分区代号：M主人 P约定 C续缘 R喜好 T时间线 X<n>自定义。',
    parameters: obj({ folder: { ...str, description: '分区代号，如 M / P / C' } }, ['folder']),
    output: textOutput,
    async execute(a) { return run(['open', String(a.folder)]) },
  })
  ctx.tools.register({
    name: 'plastic_memory_add',
    description: '可塑性记忆：把一条记忆放进待审批队列——主人会在设置里看到，能改、能驳回、能采纳。单条不超过 30 个字，开头加 * 表示重要。禁止记密码、token、密钥。',
    parameters: obj({
      folder: { ...str, description: '分区代号，如 M / P / C' },
      text: { ...str, description: '要记的内容，≤30 字' },
    }, ['folder', 'text']),
    output: textOutput,
    async execute(a) { return run(['add', String(a.folder), String(a.text)]) },
  })
  ctx.tools.register({
    name: 'plastic_memory_pending',
    description: '可塑性记忆：看待审批队列——主人还没采纳的记忆都在这里。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return run(['pending']) },
  })
  ctx.tools.register({
    name: 'plastic_memory_gc',
    description: '可塑性记忆：跑一次遗忘曲线——7 天内的保留，7~30 天压缩只留重要的，30 天后的进回收站；主人信息和约定不删。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return run(['gc']) },
  })

  // ---- 给设置页 / 顶部栏用的只读接口 ----
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
function readPendingList() {
  const home = process.env.MEMTREE_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'plastic-memory')
  try { const a = JSON.parse(readFileSync(join(home, '_pending.json'), 'utf8')); return Array.isArray(a) ? a : [] } catch { return [] }
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
      try {
        if (p === '/list') return json(res, 200, { ok: true, ...listFolders() })
        if (p === '/open') return json(res, 200, openFolder(u.searchParams.get('k') || ''))
        if (p === '/gc') return json(res, 200, { ok: true, out: run(['gc']) })
        if (p === '/init') return json(res, 200, { ok: true, out: run(['init']) })
        if (p === '/pending') return json(res, 200, { ok: true, rows: readPendingList() })
        if (req.method === 'POST' && p === '/approve') { const b = await readBody(req); return json(res, 200, { ok: true, out: run(['approve', String(b.id)]) }) }
        if (req.method === 'POST' && p === '/reject') { const b = await readBody(req); return json(res, 200, { ok: true, out: run(['reject', String(b.id)]) }) }
        if (req.method === 'POST' && p === '/edit') { const b = await readBody(req); return json(res, 200, { ok: true, out: run(['edit', String(b.id), String(b.text)]) }) }
        if (req.method === 'POST' && p === '/mk') { const b = await readBody(req); return json(res, 200, { ok: true, out: run(['mk', String(b.name), ...(b.parent ? [String(b.parent)] : [])]) }) }
        if (req.method === 'POST' && p === '/add-now') { const b = await readBody(req); return json(res, 200, { ok: true, out: run(['add-now', String(b.folder), String(b.text)]) }) }
        return json(res, 404, { ok: false, error: 'unknown' })
      } catch (e) {
        return json(res, 500, { ok: false, error: e?.message || String(e) })
      }
    },
  })
}
