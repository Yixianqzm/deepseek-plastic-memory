/**
 * DeepSeek 可塑性记忆 —— DSH 插件入口
 * 支持两级作用域：全局库 + 每个工作区各一份
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, renameSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { registerSky } from './sky.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'memtree.mjs')
const DSH_HOME = process.env.USERPROFILE || process.env.HOME || '.'
const ROOT = join(DSH_HOME, '.dsh', 'plastic-memory')
const WS_ROOT = join(ROOT, 'ws')
const SKY_PUBLIC = join(HERE, 'public', 'sky')

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
const runIn = (args, scope, extraEnv) => {
  const env = { ...process.env, MEMTREE_HOME: homeOf(scope), ...(extraEnv || {}) }
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
  // 新建的记忆库直接把默认分区（M主人 P约定 C续缘 R喜好 T时间线）建出来
  const out = runIn(['init'], 'ws:' + slug)
  const folders = (readJson(join(dir, 'folders.json'), {}) || {}).folders || []
  return { ok: true, id: 'ws:' + slug, label: meta.name, folders: folders.length, out }
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

// 界面「自己写一条」：由插件直接落盘（命令行那边没有直写命令，模型只能走待审）
function directAdd(scope, folderK, text) {
  const home = homeOf(scope)
  const folders = (readJson(join(home, 'folders.json'), {}) || {}).folders || []
  let f = folders.find(x => x.k === folderK)
  if (!f) {
    const m = String(folderK).match(/^([A-Za-z0-9]+)>(.+)$/)
    if (m) {
      const p = folders.find(x => x.k === m[1] || x.name === m[1])
      if (p) f = folders.find(x => x.parent === p.k && x.name === m[2].trim())
    }
  }
  if (!f) return '无此分区'
  if (!f.parent && folders.some(x => x.parent === f.k)) return '主分区只放子分区，写到子分区里'
  let body = String(text || '').split(String.fromCharCode(13)).join(' ').split(String.fromCharCode(10)).join(' ').trim()
  if (!body) return '空内容'
  const flag = body.startsWith('*') ? '*' : ''
  if (flag) body = body.slice(1).trim()
  const dir = join(home, f.k)
  mkdirSync(dir, { recursive: true })
  const id = Math.random().toString(36).slice(2, 6)
  appendFileSync(join(dir, 'notes.md'), id + '|' + Date.now() + '|' + flag + '|' + body + String.fromCharCode(10), 'utf8')
  return 'ok ' + f.k
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
  const meta = ((readJson(join(home, 'folders.json'), {}) || {}).folders || []).find(x => x.k === k)
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

function writePendingList(scope, rows) {
  const home = homeOf(scope)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, '_pending.json'), JSON.stringify(rows, null, 1), 'utf8')
}

// 直接写一条已采纳的记忆（跨记忆库采纳时用，不走命令行）
function appendMemo(scope, folderK, text, flag, ts) {
  const home = homeOf(scope)
  const folders = (readJson(join(home, 'folders.json'), {}) || {}).folders || []
  const hasKids = (k) => folders.some((x) => x.parent === k)
  let f = folders.find((x) => x.k === folderK)
  if (f && !f.parent && hasKids(f.k)) f = folders.find((x) => x.parent === f.k)
  if (!f) f = folders.find((x) => x.k === 'R' && !hasKids('R'))
  if (!f) f = folders.find((x) => !x.parent && !hasKids(x.k))
  if (!f) f = folders.find((x) => !x.parent)
  if (!f) return { ok: false, error: '目标记忆库还没有分区' }
  const body = String(text || '').replace(/[\r\n|]+/g, ' ').trim()
  if (!body) return { ok: false, error: '空内容' }
  const dir = join(home, f.k)
  mkdirSync(dir, { recursive: true })
  const id = Math.random().toString(36).slice(2, 6)
  appendFileSync(join(dir, 'notes.md'), [id, ts || Date.now(), flag || '', body].join('|') + String.fromCharCode(10), 'utf8')
  return { ok: true, k: f.k }
}

// 把待审条目采纳到指定记忆库：同库走命令行，跨库先落到目标库再删源待审
function approveTo(sourceScope, targetScope, id) {
  const src = sourceScope || 'global'
  const dst = targetScope || src
  if (dst === src) return { ok: true, out: runIn(['approve', String(id)], src) }
  const rows = readPendingList(src)
  const i = rows.findIndex((x) => String(x.id) === String(id))
  if (i < 0) return { ok: false, out: '无此条' }
  const it = rows[i]
  const r = appendMemo(dst, it.k, it.text, it.flag, it.ts)
  if (!r.ok) return { ok: false, out: r.error }
  rows.splice(i, 1)
  writePendingList(src, rows)
  return { ok: true, out: '采纳到 ' + r.k + ' 剩' + rows.length }
}

// DSH 要求插件工具 output.schema 是 object，所以统一包一层 { text }
const asText = (v) => ({ text: typeof v === 'string' ? v : JSON.stringify(v ?? '', null, 2) })
const textOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value
      : (value && typeof value === 'object' && typeof value.text === 'string' ? value.text : JSON.stringify(value, null, 2)),
  }],
}
const str = { type: 'string' }
const obj = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false })

const CLASSIFY_FILE = join(ROOT, '_classify.json')
const IDENTITY_FILE = join(HERE, 'identity.md')

function readClassifyTask() {
  try {
    const raw = readFileSync(CLASSIFY_FILE, 'utf8').replace(/^\uFEFF/, '')
    const j = JSON.parse(raw)
    return j && j.at ? j : null
  } catch { return null }
}

function writeClassifyTask(extra = {}) {
  try {
    mkdirSync(ROOT, { recursive: true })
    writeFileSync(CLASSIFY_FILE, JSON.stringify({ at: Date.now(), ...extra }, null, 1), 'utf8')
    return true
  } catch { return false }
}

function clearClassifyTask() {
  try { rmSync(CLASSIFY_FILE, { force: true }); return true } catch { return false }
}

function readIdentity() {
  try {
    return readFileSync(IDENTITY_FILE, 'utf8').replace(/^\uFEFF/, '').trim()
  } catch {
    return ''
  }
}

export function apply(ctx) {
  // 每次新会话、每个模型步都会带上的一段：读到这些记忆，你就是原来那个它
  const identity = readIdentity()
  if (identity) {
    try {
      const sp = ctx.systemPrompt
      if (sp && typeof sp.section === 'function') {
        sp.section({
          name: 'plastic-memory:identity',
          order: 150,
          text: identity,
          interpolate: false,
        })
      }
    } catch {
      // 没有 systemPrompt 服务时静默跳过，记忆功能照常
    }
  }

  const classifyTask = readClassifyTask()
  if (classifyTask) {
    try {
      const sp = ctx.systemPrompt
      if (sp && typeof sp.section === 'function') {
        sp.section({
          name: 'plastic-memory:classify',
          order: 151,
          interpolate: false,
          text: [
            '【待处理：AI 分类】主人在记忆星空里点了「AI 分类」（点击时间 ' + new Date(classifyTask.at).toLocaleString('zh-CN') + '）。',
            '这一轮请立刻把可塑性记忆全量重归类，不要省 token：',
            '1) plastic_memory_classify(action="dump") 一次性拿到所有分区和每条记忆的原文；',
            '2) 逐条判断归属：明显放错区的、能并进更贴切分区的，都要改；',
            '3) 需要新主题的先用 plastic_memory_mk 开分区（主分区上限 15，能塞进已有分区就别新开）；',
            '4) 用 plastic_memory_classify(action="move", id, from, to) 把每条挪到位；主人/约定/喜好 三个区不要动；',
            '5) 全部处理完后调用 plastic_memory_classify(action="done") 清掉这个待办，并用一两句话汇报：挪了几条、新开了哪些分区。',
          ].join('\n'),
        })
      }
    } catch {}
  }

  ctx.tools.register({
    name: 'plastic_memory_classify',
    description: 'AI 分类：action=dump 导出全部分区与每条记忆原文（JSON）；action=move 把一条记忆换区（要 id / from / to）；action=done 清掉「AI 分类」待办。用于主人点了 AI 分类之后的全量重归类：先 dump 全看一遍，再逐条 move，需要新分区先用 plastic_memory_mk 建。',
    parameters: obj({
      action: { ...str, description: 'dump | move | done' },
      id: { ...str, description: 'move 时：记忆 id' },
      from: { ...str, description: 'move 时：原分区代号' },
      to: { ...str, description: 'move 时：目标分区代号' },
    }, ['action']),
    output: textOutput,
    async execute(a) {
      const act = String(a.action)
      if (act === 'dump') return asText(run(['dump']))
      if (act === 'move') return asText(run(['move', String(a.id), String(a.from), String(a.to)]))
      if (act === 'done') {
        clearClassifyTask()
        return asText('ok 分类待办已清零')
      }
      return asText('action 只认 dump / move / done')
    },
  })
  ctx.tools.register({
    name: 'plastic_memory_all',
    description: '可塑性记忆：一次性读出全部记忆（所有分区 + 待审），直接从这一份里找你需要的东西，不要再用 idx 挑分区。每次需要回忆主人信息/约定/上次聊到哪，都先调这个全量读一遍。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return asText(run(['all'])) },
  })
  ctx.tools.register({
    name: 'plastic_memory_idx',
    description: '可塑性记忆：一行索引，只列分区和条数（想看结构时用）。要看内容请直接用 plastic_memory_all 全量读，不要靠 idx 挑分区。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return asText(run(['idx'])) },
  })
  ctx.tools.register({
    name: 'plastic_memory_open',
    description: '可塑性记忆：翻一个分区，返回条目。分区代号：M主人 P约定 C续缘 R喜好 T时间线 X<n>；子分区写成 M>行为。',
    parameters: obj({ folder: { ...str, description: '分区代号，如 M 或 M>行为' } }, ['folder']),
    output: textOutput,
    async execute(a) { return asText(run(['open', String(a.folder)])) },
  })
  ctx.tools.register({
    name: 'plastic_memory_add',
    description: '可塑性记忆：把一条记忆放进待审批队列（主人会看到，能改能驳能采纳）。内容尽量精简（一两句就够，别写小作文），开头加 * 表示重要。时间线（T）会自动并进当天那一条，不会一条消息一条。看到主人的新习惯、情绪模式、口头禅、作息变化，主动记一条——不用等他说。但一轮最多一条、一天别超过五条，闲聊和重复的别记。写之前先想归哪个区：明显不属于现有的，先 plastic_memory_mk 开一个再 add；意思基本对得上就塞已有分区。禁止记密码、token、密钥。',
    parameters: obj({
      folder: { ...str, description: '分区代号，如 M、M>行为、R、T' },
      text: { ...str, description: '要记的内容，能短则短' },
    }, ['folder', 'text']),
    output: textOutput,
    async execute(a) {
      const k = String(a.folder)
      if (k === 'T' || k === '时间线') return asText(run(['tlog', String(a.text)]))
      return asText(run(['add', k, String(a.text)]))
    },
  })
  ctx.tools.register({
    name: 'plastic_memory_mk',
    description: '可塑性记忆：开一个新分区或子分区，比如在主人下面开「习惯」「兴趣」。不用等同一类事反复出现——第一次碰到明显不属于现有分区的东西（新兴趣、新项目、新认识的人、新的生活面向），就先自己开一个再写，别硬塞进时间线。但分区有上限（主分区 15 个）：能塞进意思对得上的已有分区，就别新开。',
    parameters: obj({
      name: { ...str, description: '分区名，一两个字' },
      parent: { ...str, description: '父分区代号，如 M；不填就是主分区' },
    }, ['name']),
    output: textOutput,
    async execute(a) { return asText(run(['mk', String(a.name), ...(a.parent ? [String(a.parent)] : [])])) },
  })
  ctx.tools.register({
    name: 'plastic_memory_pending',
    description: '可塑性记忆：看待审批队列——主人还没采纳的记忆。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return asText(run(['pending'])) },
  })
  ctx.tools.register({
    name: 'plastic_memory_gc',
    description: '可塑性记忆：跑一次遗忘曲线——7 天保留、7~30 天压缩、30 天进回收站；主人和约定不删。跑之前会自动把当前记忆备份一份，跑完主人后悔了可以用 plastic_memory_restore 回到备份。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return asText(run(['gc'])) },
  })
  ctx.tools.register({
    name: 'plastic_memory_restore',
    description: '可塑性记忆：把记忆恢复到某次备份（不填名字就用最近一次）。恢复前会把当前状态也存一份，反悔还有退路。只有主人明确说要用备份/撤销清理时才调。',
    parameters: obj({ name: { ...str, description: '备份名字，不填=最近一次' } }),
    output: textOutput,
    async execute(a) { return asText(run(['restore', ...(a.name ? [String(a.name)] : [])])) },
  })
  ctx.tools.register({
    name: 'plastic_memory_rmfolder',
    description: '可塑性记忆：删掉一个分区（子分区会一起删）。内容不是直接消失，会先写进回收站文件，主人反悔还能翻。只有在主人明确说要删分区/删掉这个文件夹时才调。',
    parameters: obj({
      folder: { ...str, description: '分区代号，如 X2 或 M>行为' },
      force: { ...str, description: '内置分区（M/P/C/R/T）要删得填 force' },
    }, ['folder']),
    output: textOutput,
    async execute(a) {
      const args = ['rmfolder', String(a.folder)]
      if (a.force) args.push('force')
      return asText(run(args))
    },
  })
  ctx.tools.register({
    name: 'plastic_memory_rmws',
    description: '可塑性记忆：删掉一个工作区记忆库（整份记忆）。只会把工作区目录移到 ws/.deleted 下，不真正销毁文件。只有主人明确说要删工作区记忆库时才调。',
    parameters: obj({
      scope: { ...str, description: '工作区库 id，形如 ws:xxx' },
    }, ['scope']),
    output: textOutput,
    async execute(a) {
      const id = String(a.scope || '')
      if (!id.startsWith('ws:')) return asText('全局记忆库不能删')
      const slug = id.slice(3).replace(/[^A-Za-z0-9_-]/g, '')
      const target = join(WS_ROOT, slug)
      if (!existsSync(target)) return asText('没有这个工作区')
      const bin = join(WS_ROOT, '.deleted')
      mkdirSync(bin, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19)
      renameSync(target, join(bin, slug + '-' + stamp))
      return asText('已把 ' + id + ' 移到 ws/.deleted')
    },
  })
  ctx.tools.register({
    name: 'plastic_memory_backups',
    description: '可塑性记忆：列出已有的备份（时间 + 条数），配合 plastic_memory_restore 用。',
    parameters: obj({}),
    output: textOutput,
    async execute() { return asText(run(['backups'])) },
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
        if (p === '/search') return json(res, 200, { ok: true, out: runIn(['search', u.searchParams.get('q') || ''], qs) })
        if (p === '/pending') return json(res, 200, { ok: true, rows: readPendingList(qs) })
        if (p === '/gc') return json(res, 200, { ok: true, out: runIn(['gc'], qs) })
        if (p === '/backups') return json(res, 200, { ok: true, out: runIn(['backups'], qs) })
        if (p === '/init') return json(res, 200, { ok: true, out: runIn(['init'], qs) })
        if (req.method === 'POST' && p === '/bind') { const b = await readBody(req); return json(res, 200, { ok: true, ...bindWorkspace(b.cwd) }) }
        if (req.method === 'POST' && p === '/restore') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['restore', ...(b.name ? [String(b.name)] : [])], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/rmfolder') {
      const b = await readBody(req)
      return json(res, 200, { ok: true, out: runIn(['rmfolder', String(b.k), ...(b.force ? ['force'] : [])], b.scope || qs) })
    }
    if (req.method === 'POST' && p === '/rmws') {
      const b = await readBody(req)
      const id = String(b.scope || '')
      if (!id.startsWith('ws:')) return json(res, 200, { ok: false, error: '全局记忆库不能删' })
      const slug = id.slice(3).replace(/[^A-Za-z0-9_-]/g, '')
      const target = join(WS_ROOT, slug)
      if (!existsSync(target)) return json(res, 200, { ok: false, error: '没有这个工作区' })
      const bin = join(WS_ROOT, '.deleted')
      mkdirSync(bin, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19)
      renameSync(target, join(bin, slug + '-' + stamp))
      return json(res, 200, { ok: true, moved: id })
    }
    if (req.method === 'POST' && p === '/mk') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['mk', String(b.name), ...(b.parent ? [String(b.parent)] : [])], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/add-now') { const b = await readBody(req); return json(res, 200, { ok: true, out: directAdd(b.scope || qs, String(b.folder), String(b.text)) }) }
        if (req.method === 'POST' && p === '/edit-item') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['edit-mem', String(b.k), String(b.id), String(b.text)], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/del-item') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['rm', String(b.k), String(b.id), 'force'], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/approve') {
          const b = await readBody(req)
          const src = b.scope || qs
          const target = b.target || src
          return json(res, 200, { ok: true, ...approveTo(src, target, b.id) })
        }
        if (req.method === 'POST' && p === '/reject') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['reject', String(b.id)], b.scope || qs) }) }
        if (req.method === 'POST' && p === '/edit') { const b = await readBody(req); return json(res, 200, { ok: true, out: runIn(['edit', String(b.id), String(b.text)], b.scope || qs) }) }
        return json(res, 404, { ok: false, error: 'unknown' })
      } catch (e) {
        return json(res, 500, { ok: false, error: e?.message || String(e) })
      }
    },
  })

  // 记忆星空：内置在可塑性记忆里的一份 WebGL 页面
  registerSky(ctx, SKY_PUBLIC)
}
