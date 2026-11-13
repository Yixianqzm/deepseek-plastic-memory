/**
 * DeepSeek 可塑性记忆 —— DSH 插件入口
 * 支持两级作用域：全局库 + 每个工作区各一份
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { registerSky } from './sky.js'
import { registerDshGo } from './lib/dshgo.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'memtree.mjs')
const DSH_HOME = process.env.USERPROFILE || process.env.HOME || '.'
const ROOT = join(DSH_HOME, '.dsh', 'plastic-memory')
const WS_ROOT = join(ROOT, 'ws')
const SKY_PUBLIC = join(HERE, 'public', 'sky')

// ---- 情绪推导配置 ----
// 插件不自带任何厂商默认值：端点 / 模型 / 密钥都由用的人自己填。
// votes：一次推导并行发几次取多数决（1 = 最省，3 = 默认，5 = 更稳但更慢）。
// fast：true = 关思考（OpenAI 兼容的 reasoning_effort:"none"），只对支持它的端点有效。
// retry：true = 各执一词时再补两票（多等一轮，换一点确定性）。
const EMO_CONFIG = join(ROOT, 'emotion-config.json')
const EMO_FIELDS = ['apiBase', 'model', 'apiKey']
function readEmoConfig() {
  try {
    const j = JSON.parse(readFileSync(EMO_CONFIG, 'utf8').replace(/^﻿/, ''))
    const v = Number(j.votes)
    const pick = (k) => (typeof j[k] === 'string' ? j[k] : '')
    return {
      enabled: j.enabled !== false,
      votes: isFinite(v) && v >= 1 && v <= 5 ? Math.round(v) : 3,
      fast: j.fast !== false,
      retry: j.retry === true,
      apiBase: pick('apiBase'),
      model: pick('model'),
      apiKey: pick('apiKey'),
    }
  } catch {
    return { enabled: true, votes: 3, fast: true, retry: false, apiBase: '', model: '', apiKey: '' }
  }
}
function writeEmoConfig(cfg) {
  try {
    const cur = readEmoConfig()
    const next = {
      enabled: cfg.enabled !== undefined ? cfg.enabled !== false : cur.enabled,
      votes: cfg.votes !== undefined ? Math.min(5, Math.max(1, Math.round(Number(cfg.votes) || 3))) : cur.votes,
      fast: cfg.fast !== undefined ? cfg.fast !== false : cur.fast,
      retry: cfg.retry !== undefined ? cfg.retry === true : cur.retry,
    }
    // 字符串字段：传了就用传的（空串 = 清掉），没传就保留
    for (const k of EMO_FIELDS) next[k] = cfg[k] !== undefined ? String(cfg[k]) : cur[k]
    writeFileSync(EMO_CONFIG, JSON.stringify(next, null, 2))
    return true
  } catch { return false }
}

/** 情绪推理是否开着（全局一个开关） */
function emoOn() {
  return readEmoConfig().enabled !== false
}

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
const run = (args, scope) => runIn(args, scope || 'global')

/** DSH 的工作区表：sessionIds 能反查出这个会话属于哪个工作区 */
function readWsTable() {
  const j = readJson(join(DSH_HOME, '.dsh', 'storages', 'workspace.json'), {})
  return { ws: (j.tables && j.tables.workspaces) || {}, def: (j.global && j.global.defaultWorkspaceId) || '' }
}
let SESS_WS = { at: 0, v: null }
/** 当前会话所属的 DSH 工作区（5 秒缓存）；查不到就用默认工作区 */
function sessionWorkspace() {
  const now = Date.now()
  if (now - SESS_WS.at < 5000) return SESS_WS.v
  const { ws, def } = readWsTable()
  const sid = process.env.DSH_SESSION_ID || ''
  let hit = null
  if (sid) {
    for (const [id, w] of Object.entries(ws)) {
      if (Array.isArray(w.sessionIds) && w.sessionIds.includes(sid)) { hit = { id, ...w }; break }
    }
  }
  if (!hit && def && ws[def]) hit = { id: def, ...ws[def] }
  const v = hit && hit.path ? { id: hit.id, path: String(hit.path), title: hit.title || basename(String(hit.path)) } : null
  SESS_WS = { at: now, v }
  return v
}
/** 这个工作区已经有记忆库了吗 */
function wsScopeOf(ws) {
  if (!ws || !ws.path) return ''
  const slug = slugOf(ws.path)
  return existsSync(join(WS_ROOT, slug)) ? 'ws:' + slug : ''
}
/** 工具的 scope 参数：不传就还是写全局（跟以前一样），传 ws 才落到当前工作区 */
function resolveScope(arg) {
  const a = String(arg || '').trim() || 'global'
  if (a === 'global' || a === '全局') return 'global'
  if (a.startsWith('ws:')) {
    // 显式指了某工作区库：不存在的就当没有，别把记忆写进空气里
    const slug = a.slice(3).replace(/[^A-Za-z0-9_-]/g, '')
    return existsSync(join(WS_ROOT, slug)) ? 'ws:' + slug : 'global'
  }
  const ws = sessionWorkspace()
  if (a === 'ws' || a === '工作区') {
    if (!ws) return 'global'
    const slug = slugOf(ws.path)
    if (!existsSync(join(WS_ROOT, slug))) bindWorkspace(ws.path)
    return 'ws:' + slug
  }
  return (ws && wsScopeOf(ws)) || 'global'
}
function scopeLabel(scope) {
  if (!scope || scope === 'global') return '全局'
  const one = listScopes().find((x) => x.id === scope)
  return one ? '工作区 ' + String(one.label).replace(/（未建库）/, '') : scope
}
/** 工具统一出口：落哪个库、写一句话告诉模型 */
function runTool(a, args) {
  const s = resolveScope(a && a.scope)
  const out = runIn(args, s)
  return asText('[' + scopeLabel(s) + '] ' + out)
}

function listScopes() {
  const out = [{ id: 'global', label: '全局', home: ROOT }]
  const cur = sessionWorkspace()
  const curSlug = cur ? slugOf(cur.path) : ''
  try {
    for (const d of readdirSync(WS_ROOT, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      if (d.name === '.deleted') continue
      const metaPath = join(WS_ROOT, d.name, 'meta.json')
      let meta = {}
      try { meta = JSON.parse(readFileSync(metaPath, 'utf8')) } catch {}
      out.push({
        id: 'ws:' + d.name, label: meta.name || d.name, cwd: meta.cwd || '',
        home: join(WS_ROOT, d.name), current: d.name === curSlug,
      })
    }
  } catch {}
  // 当前会话的工作区还没建库：也列出来，选中时会自动建
  if (curSlug && !out.some((x) => x.id === 'ws:' + curSlug)) {
    out.push({
      id: 'ws:' + curSlug, label: cur.title + '（未建库）', cwd: cur.path,
      home: join(WS_ROOT, curSlug), current: true, pending: true,
    })
  }
  return out
}

function bindWorkspace(cwd) {
  if (!cwd) return { ok: false, error: 'no cwd' }
  // 目录不存在就别建库，免得造出一辈子空的记忆库
  if (!existsSync(String(cwd))) return { ok: false, error: '这个目录不存在：' + cwd }
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
// 主分区只是容器：下面已经有子分区时，不许直接往里写。
// 写进去也不会进提示词、不进情绪语境（情绪语境只扫 M-1/M-2/P/C/R），
// 所以这里直接挡住，并把可选的子分区带回去让 UI 提示。
function folderGuard(scope, k) {
  const home = homeOf(scope || 'global')
  const folders = (readJson(join(home, 'folders.json'), {}) || {}).folders || []
  const raw = String(k || '').trim()
  const parts = raw.split('>').map((s) => s.trim()).filter(Boolean)
  const key = parts.length > 1 ? parts[parts.length - 1] : raw
  let f = folders.find((x) => x.k === key || x.name === key)
  if (!f && parts.length > 1) {
    // 兼容「M>子分区名」这种写法
    const p = folders.find((x) => x.k === parts[0] || x.name === parts[0])
    if (p) f = folders.find((x) => x.parent === p.k && (x.k === key || x.name === key))
  }
  // missing = 真的没有这个分区；不是「写不进去」，别让前端弹成操作不合法
  if (!f) return { ok: false, missing: true, reason: '找不到分区「' + raw + '」' }
  if (f.parent) return { ok: true, k: f.k }
  const kids = folders.filter((x) => x.parent === f.k)
  if (!kids.length) return { ok: true, k: f.k }
  const list = kids.map((x) => x.k + ' ' + x.name)
  return {
    ok: false,
    k: f.k,
    kids: list,
    reason: '「' + f.k + ' ' + f.name + '」是主分区，下面已经有 ' + kids.length +
      ' 个子分区（' + list.join('、') + '）。\n\n主分区只当容器：直接写进去的内容不会进系统提示词，也不会进情绪语境——等于写了不生效。\n\n要写就写进其中一个子分区。',
  }
}

function approveTo(sourceScope, targetScope, id) {
  const src = sourceScope || 'global'
  const dst = targetScope || src
  const rows = readPendingList(src)
  const i = rows.findIndex((x) => String(x.id) === String(id))
  if (i < 0) return { ok: false, out: '无此条' }
  const it = rows[i]
  const g = folderGuard(dst, it.k)
  if (!g.ok) return { ok: false, blocked: !g.missing, reason: g.reason, kids: g.kids || [] }
  if (dst === src) return { ok: true, out: runIn(['approve', String(id)], src) }
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
const scopeArg = {
  ...str,
  description: '写/读哪个记忆库。不填 = 全局（默认，跟以前一样）。global = 强制全局；auto = 当前会话工作区已有记忆库就用它、没有就用全局；ws = 当前会话工作区（还没建库会自动建）。也可以用 ws:xxx 指定某个工作区库。返回开头会标出实际落到哪个库。',
}
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

function readAllMemoriesText(scope) {
  const home = homeOf(scope || 'global')
  try {
    const j = JSON.parse(readFileSync(join(home, 'folders.json'), 'utf8').replace(/^\uFEFF/, ''))
    const folders = Array.isArray(j.folders) ? j.folders : []
    const lines = []
    for (const f of folders) {
      const file = join(home, f.k, 'notes.md')
      if (!existsSync(file)) continue
      const rows = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean)
      if (!rows.length) continue
      lines.push('## ' + (f.parent ? f.parent + '>' : '') + f.name + ' (' + f.k + ')')
      for (const row of rows) {
        const [id, , flag, ...rest] = row.split('|')
        const mark = flag === '*' ? ' [重要]' : flag === '✓' ? ' [完成]' : ''
        lines.push((id || '') + mark + ' ' + rest.join('|'))
      }
      lines.push('')
    }
    // 不截断：记忆有多少就带多少
    return lines.join('\n').trim()
  } catch {
    return ''
  }
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
          text: () => readIdentity() || '',
          interpolate: false,
        })
      }
    } catch {
      // 没有 systemPrompt 服务时静默跳过，记忆功能照常
    }
  }

  // 全量记忆：每次会话都带上，模型不用再去挑分区
  try {
    const sp = ctx.systemPrompt
    if (sp && typeof sp.section === 'function') {
      sp.section({
        name: 'plastic-memory:all',
        order: 149,
        interpolate: false,
        text: () => {
          const NL2 = String.fromCharCode(10)
          const blocks = []
          const g = readAllMemoriesText('global')
          if (g && g !== '(空)') {
            blocks.push(['【可塑性记忆 · 全局】下面是这台机器上的全局记忆（已按分区排好）：', '', g].join(NL2))
          }
          // 工作区记忆以前完全进不来：写进去等于白写
          const ws = sessionWorkspace()
          const wsScope = ws ? wsScopeOf(ws) : ''
          if (wsScope) {
            const w = readAllMemoriesText(wsScope)
            if (w && w !== '(空)') {
              blocks.push(['【可塑性记忆 · 工作区 ' + ws.title + '】这个工作区自己的记忆：', '', w].join(NL2))
            }
          }
          return blocks.join(NL2 + NL2)
        },
      })
    }
  } catch (e) {
    // 读不到就静默跳过，别影响对话
  }

  // 情绪推导：只有内联一种。不另发请求——判据 + 记忆语境直接进系统提示词，
  // 主模型在同一轮请求里自己过一遍。官模、中转、自建端点一视同仁。
  try {
    const sp = ctx.systemPrompt
    if (sp && typeof sp.section === 'function') {
      sp.section({
        name: 'plastic-memory:emotion',
        order: 148,
        interpolate: false,
        text: () => {
          try { if (!emoOn()) return '' } catch { return '' }
          const NL = String.fromCharCode(10)
          const mem = emoMemContext()
          const lines = [
            '【情绪推导】回对方消息之前，先在内部把这几件事过一遍，再决定怎么说——判断过程不要写给对方看：',
            '  意图——说明（陈述事实）/ 安抚澄清（在解释、在挽回）/ 划边界（在拒绝、在拉开距离）/ 求助（在示弱、等你接）/ 试探（在探你的反应），挑一个',
            '  情绪——正向平静 / 负向克制 / 负向外显 / 中性',
            '  回法——一句话定下语气、长度、要不要追问',
            '按判读结果回：划边界就别追问、别解释太多；求助就接住；试探就给明确信号；说明就直答。同一句不要自我怀疑两遍。',
            '有歧义时（几种意图都说得通）按最不越界的那种回，别过度解读。',
          ]
          if (mem.length) {
            lines.push('关于这个人的记忆，判断时优先于字面（雷点、称呼、习惯都在里面）：')
            lines.push(mem.join(NL))
          }
          return lines.join(NL)
        },
      })
    }
  } catch {}

  // AI 分类待办：以前只在插件启动时读一次，运行中点了「AI 分类」要重启才生效。
  // 改成每次构建提示词都读，点完立刻进下一轮。
  try {
    const sp = ctx.systemPrompt
    if (sp && typeof sp.section === 'function') {
      sp.section({
        name: 'plastic-memory:classify',
        order: 151,
        interpolate: false,
        text: () => {
          const classifyTask = readClassifyTask()
          if (!classifyTask) return ''
          return [
            '【待处理：AI 分类】主人在记忆星空里点了「AI 分类」（点击时间 ' + new Date(classifyTask.at).toLocaleString('zh-CN') + '）。',
            '这一轮请立刻把可塑性记忆全量重归类，不要省 token：',
            '1) plastic_memory_classify(action="dump") 一次性拿到所有分区和每条记忆的原文；',
            '2) 逐条判断归属：明显放错区的、能并进更贴切分区的，都要改；',
            '3) 需要新主题的先用 plastic_memory_mk 开分区（主分区上限 15，能塞进已有分区就别新开）；',
            '4) 用 plastic_memory_classify(action="move", id, from, to) 把每条挪到位；主人/约定/喜好 三个区不要动；',
            '5) 全部处理完后调用 plastic_memory_classify(action="done") 清掉这个待办，并用一两句话汇报：挪了几条、新开了哪些分区。',
          ].join('\n')
        },
      })
    }
  } catch {}

  ctx.tools.register({
    name: 'plastic_memory_classify',
    description: 'AI 分类：action=dump 导出全部分区与每条记忆原文（JSON）；action=move 把一条记忆换区（要 id / from / to）；action=done 清掉「AI 分类」待办。用于主人点了 AI 分类之后的全量重归类：先 dump 全看一遍，再逐条 move，需要新分区先用 plastic_memory_mk 建。',
    parameters: obj({
      action: { ...str, description: 'dump | move | done' },
      id: { ...str, description: 'move 时：记忆 id' },
      from: { ...str, description: 'move 时：原分区代号' },
      to: { ...str, description: 'move 时：目标分区代号' },
      scope: scopeArg,
    }, ['action']),
    output: textOutput,
    async execute(a) {
      const act = String(a.action)
      if (act === 'dump') return runTool(a, ['dump'])
      if (act === 'move') return runTool(a, ['move', String(a.id), String(a.from), String(a.to)])
      if (act === 'done') {
        clearClassifyTask()
        return asText('ok 分类待办已清零')
      }
      return asText('action 只认 dump / move / done')
    },
  })
  ctx.tools.register({
    name: 'plastic_memory_all',
    description: '可塑性记忆：一次性读出全部记忆（所有分区 + 待审），直接从这一份里找你需要的东西，不要再用 idx 挑分区。每次需要回忆主人信息/约定/上次聊到哪，都先调这个全量读一遍。不传 scope 就读全局；传 auto 则当前会话工作区有库就读它。返回开头会标出读的是哪个库。',
    parameters: obj({ scope: scopeArg }),
    output: textOutput,
    async execute(a) { return runTool(a, ['all']) },
  })
  ctx.tools.register({
    name: 'plastic_memory_idx',
    description: '可塑性记忆：一行索引，只列分区和条数（想看结构时用）。要看内容请直接用 plastic_memory_all 全量读，不要靠 idx 挑分区。不传 scope 读全局，auto 读当前工作区。',
    parameters: obj({ scope: scopeArg }),
    output: textOutput,
    async execute(a) { return runTool(a, ['idx']) },
  })
  ctx.tools.register({
    name: 'plastic_memory_open',
    description: '可塑性记忆：翻一个分区，返回条目。分区代号：M主人 P约定 C续缘 R喜好 T时间线 X<n>；子分区写成 M>行为。不传 scope 读全局，auto 读当前工作区。',
    parameters: obj({ folder: { ...str, description: '分区代号，如 M 或 M>行为' }, scope: scopeArg }, ['folder']),
    output: textOutput,
    async execute(a) { return runTool(a, ['open', String(a.folder)]) },
  })
  // ================= 情绪推导：回话前先 probe 一次 =================
  // 规则引擎在真实语料上 93% 弃权，所以这里走模型；记忆作为语境一起喂进去，
  // 让它知道"这个人是谁、哪些话是雷点"，而不是只读当前这一句。
  //
  // 连接不单独配：直接跟随宿主。DSH 把当前会话用的模型写在 profile 的
  // cordis.patch.yml（agent-default-model: provider/model），provider 的 baseURL 与
  // apiKeyEnv 在同文件 llm-pi-ai 段，密钥在 ~/.dsh/.credentials.yaml 的 refs 里。
  // 宿主换模型，推导自动跟着换。想覆盖再用 emotion-config.json / 环境变量。
  function hostProfileDir() {
    const d = process.env.DSH_PROFILE_DIR
    if (d && existsSync(d)) return d
    return join(DSH_HOME, '.dsh', 'profiles', process.env.DSH_PROFILE || 'desktop')
  }
  function readTextSafe(p) {
    try { return readFileSync(p, 'utf8').replace(/^\uFEFF/, '') } catch { return '' }
  }

  /** 极简 YAML 扫描：只读 agent-default-model 与各条目里的 providers 段，不引 yaml 依赖。 */
  function scanHostConfig(text) {
    const NLc = String.fromCharCode(10)
    const out = { def: null, llmProviders: {}, otherProviders: {} }
    let entry = null, provBlock = null, curProv = null
    for (const raw of text.split(NLc)) {
      if (!raw.trim() || /^\s*#/.test(raw)) continue
      const indent = raw.length - raw.replace(/^\s+/, '').length
      const line = raw.trim()
      const mEntry = line.match(/^-\s*id:\s*(\S+)/)
      if (mEntry) {
        // 只有顶层条目（缩进 ≤ 2）才是插件条目；models 里的 "- id:" 是列表项，别当条目
        if (indent <= 2) {
          entry = { id: mEntry[1], isLlm: /llm/i.test(mEntry[1]) }
          provBlock = null; curProv = null
          continue
        }
      }
      if (!entry) continue
      if (entry.id === 'agent-default-model') {
        const m = line.match(/^(provider|model|reasoningEffort):\s*(\S+)/)
        if (m) {
          out.def = out.def || {}
          out.def[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
        continue
      }
      // providers 段：llm-* 条目优先，其它条目只做兜底
      const bucket = entry.isLlm ? out.llmProviders : out.otherProviders
      if (/^providers:\s*$/.test(line)) { provBlock = indent; continue }
      if (provBlock === null) continue
      if (indent <= provBlock) { provBlock = null; curProv = null; continue }
      if (indent === provBlock + 2) {
        const mProv = line.match(/^([A-Za-z0-9_.-]+):\s*$/)
        if (mProv) { curProv = mProv[1]; bucket[curProv] = bucket[curProv] || {} }
        continue
      }
      const kv = line.match(/^(baseURL|baseUrl|apiKeyEnv|api|displayName):\s*(\S+)/)
      if (kv && curProv) bucket[curProv][kv[1]] = kv[2].replace(/^["']|["']$/g, '')
    }
    return out
  }

  /** 凭据文件的 refs 段：KEY: value */
  function readCredRefs() {
    const out = {}
    const NLc = String.fromCharCode(10)
    let inRefs = false
    for (const raw of readTextSafe(join(DSH_HOME, '.dsh', '.credentials.yaml')).split(NLc)) {
      if (/^refs:\s*$/.test(raw)) { inRefs = true; continue }
      if (inRefs && /^\S/.test(raw)) { inRefs = false; continue }
      if (!inRefs) continue
      const m = raw.match(/^\s+([A-Za-z0-9_]+):\s*(\S.*)$/)
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    return out
  }

  /** 凭据文件的 records 段：只取 token / secret（账号类 provider 用这个，不是 OpenAI 兼容端点） */
  function readCredRecords() {
    const out = {}
    const NLc = String.fromCharCode(10)
    let cur = null, inRecords = false
    for (const raw of readTextSafe(join(DSH_HOME, '.dsh', '.credentials.yaml')).split(NLc)) {
      if (/^records:\s*$/.test(raw)) { inRecords = true; continue }
      if (inRecords && /^\S/.test(raw)) { inRecords = false; cur = null; continue }
      if (!inRecords) continue
      const mName = raw.match(/^\s{2}([^\s:]+):\s*$/)
      if (mName) { cur = mName[1]; out[cur] = out[cur] || {}; continue }
      const mKV = raw.match(/^\s+(token|secret|apiKey|key):\s*(\S.*)$/)
      if (mKV && cur) out[cur][mKV[1]] = mKV[2].trim().replace(/^["']|["']$/g, '')
    }
    return out
  }

  /** profile 目录里所有可能含模型配置的 yml，按修改时间从旧到新（后面的覆盖前面的） */
  function configFiles(dir) {
    let names = []
    try {
      names = readdirSync(dir).filter((n) => /\.(yml|yaml)$/.test(n) && !/\.bak/.test(n))
    } catch { return [] }
    const rank = (n) => (/^cordis\.patch\.yml$/.test(n) ? 2 : /^cordis\.yml$/.test(n) ? 0 : 1)
    return names
      .map((n) => {
        let mtime = 0
        try { mtime = statSync(join(dir, n)).mtimeMs } catch {}
        return { n, rank: rank(n), mtime }
      })
      .sort((a, b) => a.rank - b.rank || a.mtime - b.mtime)
      .map((x) => join(dir, x.n))
  }

  let HOST_CACHE = { at: 0, v: null }
  /** 宿主当前会话用的模型 + 它的连接信息，5 秒缓存（宿主换模型能很快跟上）。 */
  function hostCfg() {
    const now = Date.now()
    if (HOST_CACHE.v && now - HOST_CACHE.at < 5000) return HOST_CACHE.v
    const dir = hostProfileDir()
    const merged = { def: null, llmProviders: {}, otherProviders: {} }
    for (const f of configFiles(dir)) {
      const one = scanHostConfig(readTextSafe(f))
      if (one.def) merged.def = { ...(merged.def || {}), ...one.def }
      Object.assign(merged.llmProviders, one.llmProviders)
      Object.assign(merged.otherProviders, one.otherProviders)
    }
    const provider = (merged.def && merged.def.provider) || ''
    const model = (merged.def && merged.def.model) || ''
    const p = merged.llmProviders[provider] || merged.otherProviders[provider] || {}
    const envName = p.apiKeyEnv || ''
    let apiKey = (envName && process.env[envName]) || ''
    if (!apiKey && envName) apiKey = readCredRefs()[envName] || ''
    if (!apiKey && provider) {
      // 账号类 provider：凭据在 records 里，用 provider 名模糊对一下
      const recs = readCredRecords()
      for (const [name, v] of Object.entries(recs)) {
        if (name.includes(provider) || provider.includes(name.split('/')[0])) {
          apiKey = v.token || v.secret || v.apiKey || v.key || ''
          if (apiKey) break
        }
      }
    }
    const v = {
      provider, model, profile: basename(dir),
      baseURL: p.baseURL || p.baseUrl || '', apiKey, api: p.api || '',
      // 这个 provider 是不是"能自己拼 OpenAI 兼容请求"的那种
      compatible: !!(p.baseURL || p.baseUrl) && /openai/.test(p.api || 'openai-completions'),
    }
    HOST_CACHE = { at: now, v }
    return v
  }

  /** 给 UI 看的宿主连接信息（不含密钥本体） */
  function hostInfo() {
    const h = hostCfg()
    return { provider: h.provider, model: h.model, profile: h.profile, baseURL: h.baseURL, hasKey: !!h.apiKey }
  }

  /** 记忆语境：不再靠 2-gram 字面匹配（短句和记忆几乎没有双字组重叠），
   *  改成把行为/习惯/约定里的短条目整段给模型，让它自己判断哪条相关。
   *  上限 25 条 / 2000 字，约 700 token，比"猜哪条相关"可靠得多。 */
  const EMO_KEYS = /(雷点|讨厌|生气|记仇|炸毛|不爽|喜欢|哄|委屈|亲密|宝宝|主人|称呼|怕|烦|哄我|拦一下)/
  const TECH_MEM = /(插件|端口|代码|重启|会话|配置|脚本|命令|文件|目录|npm|git|token|面板|桥|网关|部署|安装|编译|日志|接口)/

  /**
   * 情绪语境读哪几个分区：主人（M）下面所有子分区 + 约定（P）+ 喜好（R）+ 续缘（C）。
   * 不进：M 本体（那是容器）、T 时间线，以及用户自建的主分区。
   * 子分区是动态的——新建一个 M-3 也自动算进来，不用改代码。
   */
  function emoKeysOf(root) {
    const keys = []
    try {
      const j = readJson(join(root, 'folders.json'), {}) || {}
      const folders = Array.isArray(j.folders) ? j.folders : []
      for (const f of folders) if (f.parent === 'M') keys.push(f.k)
      // folders.json 缺了或没写 parent，就退一步看磁盘上有哪些 M-* 目录
      if (!keys.length) {
        for (const d of readdirSync(root, { withFileTypes: true })) {
          if (d.isDirectory() && /^M-\d+$/.test(d.name)) keys.push(d.name)
        }
      }
    } catch {}
    keys.push('P', 'R', 'C')
    return [...new Set(keys)]
  }

  function emoMemContext() {
    // 当前工作区的库 + 全局库都看：写进工作区的记忆以前完全用不上，白记
    // （typeof 兜一层：单测会把这段单独抠出来跑，缺 helper 时降级成只读全局）
    const roots = []
    let wsScope = ''
    try {
      const ws = typeof sessionWorkspace === 'function' ? sessionWorkspace() : null
      wsScope = ws && typeof wsScopeOf === 'function' ? wsScopeOf(ws) : ''
    } catch {}
    if (wsScope && typeof homeOf === 'function') roots.push(homeOf(wsScope))
    if (!roots.includes(ROOT)) roots.push(ROOT)
    const out = []
    const seen = new Set()
    for (const root of roots) {
      for (const f of emoKeysOf(root)) {
        const fp = join(root, f, 'notes.md')
        if (!existsSync(fp)) continue
        try {
          for (const line of readFileSync(fp, 'utf8').split(String.fromCharCode(10))) {
            const parts = line.split('|')
            if (parts.length < 4) continue
            const body = parts.slice(3).join('|').trim()
            if (!body) continue
            // 只喂"和这个人有关"的记忆：情绪/关系/称呼类。
            // 操作约定（改代码、开会话、插件端口）对情绪判断是纯噪声，实测会把准确率拉低 10 个点。
            if (!EMO_KEYS.test(body)) continue
            if (TECH_MEM.test(body)) continue
            if (seen.has(body)) continue
            seen.add(body)
            out.push('· ' + body)
          }
        } catch {}
      }
    }
    // 不设上限：记了多少就喂多少，旧记忆和新记忆一样算数
    return out
  }

  // ---- 依赖检测 / 安装 ----
  function declaredDeps() {
    try {
      const pkg = JSON.parse(readTextSafe(join(HERE, 'package.json')) || '{}')
      return { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) }
    } catch { return {} }
  }

  /** 静态检查（不发请求）：运行时能力、第三方依赖、宿主模型、接入地址、密钥 */
  function depChecks() {
    const items = []
    const tag = (ok) => (ok ? '✅' : '❌')
    const nodeMajor = Number(String(process.versions.node || '0').split('.')[0])
    items.push({
      name: 'Node 运行时',
      ok: nodeMajor >= 18,
      detail: 'v' + process.versions.node + (nodeMajor >= 18 ? '' : '（要 18+ 才有内置 fetch）'),
    })
    items.push({ name: '内置 fetch', ok: typeof fetch === 'function', detail: typeof fetch === 'function' ? '可用' : '不可用' })
    items.push({
      name: 'AbortController',
      ok: typeof AbortController === 'function',
      detail: typeof AbortController === 'function' ? '可用（超时熔断要用）' : '不可用',
    })

    const deps = declaredDeps()
    const names = Object.keys(deps)
    let missing = []
    if (!names.length) {
      items.push({ name: '第三方依赖', ok: true, detail: '插件零依赖，只用 Node 内置能力' })
    } else {
      for (const n of names) {
        const ok = existsSync(join(HERE, 'node_modules', n))
        if (!ok) missing.push(n)
        items.push({ name: '依赖 ' + n, ok, detail: ok ? '已安装' : '缺失' })
      }
    }

    const h = hostCfg()
    // 内联模式不看端点：只要知道是哪个模型在跑、记忆库读得到，就够判了
    items.push({
      name: '会话模型',
      ok: !!h.model,
      detail: h.model ? (h.provider ? h.provider + ' / ' + h.model : h.model) : '宿主配置里没读到 agent-default-model（内联模式照常工作，判据跟着当前模型走）',
    })
    items.push({
      name: '推理方式',
      ok: true,
      detail: '内联：判据和记忆直接进系统提示词，不另发请求',
    })
    items.push({
      name: '情绪语境',
      ok: true,
      detail: (() => {
        try {
          const n = emoMemContext().length
          return n ? n + ' 条相关记忆会随提示词一起下去' : '本次没有匹配到相关记忆（判据照样生效）'
        } catch { return '读不到记忆库' }
      })(),
    })

    const lines = items.map((i) => tag(i.ok || i.warn) + ' ' + i.name + '：' + i.detail)
    const needInstall = missing.length > 0
    return { items, missing, needInstall, out: lines.join('\n') }
  }

  /** 真装：有第三方依赖才会执行 npm install，零依赖直接说不用装 */
  function installDeps() {
    const deps = declaredDeps()
    const names = Object.keys(deps)
    if (!names.length) {
      return { ok: true, out: '插件零依赖（只用 Node 内置 fetch / AbortController），没有需要安装的东西。' }
    }
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: HERE, encoding: 'utf8', timeout: 180000, windowsHide: true,
    })
    const raw = ((r.stdout || '') + (r.stderr || '')).trim()
    const tail = raw ? raw.split(String.fromCharCode(10)).slice(-12).join(String.fromCharCode(10)) : ''
    return {
      ok: r.status === 0,
      out: (r.status === 0 ? '✅ 依赖安装完成\n' : '❌ 安装失败（exit ' + r.status + '）\n') + (tail || '（npm 没有输出）'),
    }
  }

  ctx.tools.register({
    name: 'plastic_memory_add',
    description: '可塑性记忆：把一条记忆放进待审批队列（主人会看到，能改能驳能采纳）。内容尽量精简（一两句就够，别写小作文），开头加 * 表示重要。时间线（T）会自动并进当天那一条，不会一条消息一条。看到主人的新习惯、情绪模式、口头禅、作息变化，主动记一条——不用等他说。但一轮最多一条、一天别超过五条，闲聊和重复的别记。写之前先想归哪个区：明显不属于现有的，先 plastic_memory_mk 开一个再 add；意思基本对得上就塞已有分区。禁止记密码、token、密钥。',
    parameters: obj({
      folder: { ...str, description: '分区代号，如 M、M>行为、R、T' },
      text: { ...str, description: '要记的内容，能短则短' },
      scope: scopeArg,
    }, ['folder', 'text']),
    output: textOutput,
    async execute(a) {
      const k = String(a.folder)
      if (k === 'T' || k === '时间线') return runTool(a, ['tlog', String(a.text)])
      return runTool(a, ['add', k, String(a.text)])
    },
  })
  ctx.tools.register({
    name: 'plastic_memory_mk',
    description: '可塑性记忆：开一个新分区或子分区，比如在主人下面开「习惯」「兴趣」。不用等同一类事反复出现——第一次碰到明显不属于现有分区的东西（新兴趣、新项目、新认识的人、新的生活面向），就先自己开一个再写，别硬塞进时间线。但分区有上限（主分区 15 个）：能塞进意思对得上的已有分区，就别新开。',
    parameters: obj({
      name: { ...str, description: '分区名，一两个字' },
      parent: { ...str, description: '父分区代号，如 M；不填就是主分区' },
      scope: scopeArg,
    }, ['name']),
    output: textOutput,
    async execute(a) { return runTool(a, ['mk', String(a.name), ...(a.parent ? [String(a.parent)] : [])]) },
  })
  ctx.tools.register({
    name: 'plastic_memory_pending',
    description: '可塑性记忆：看待审批队列——主人还没采纳的记忆。',
    parameters: obj({ scope: scopeArg }),
    output: textOutput,
    async execute(a) { return runTool(a, ['pending']) },
  })
  ctx.tools.register({
    name: 'plastic_memory_gc',
    description: '可塑性记忆：跑一次遗忘曲线——7 天保留、7~30 天压缩、30 天进回收站；主人和约定不删。跑之前会自动把当前记忆备份一份，跑完主人后悔了可以用 plastic_memory_restore 回到备份。',
    parameters: obj({ scope: scopeArg }),
    output: textOutput,
    async execute(a) { return runTool(a, ['gc']) },
  })
  ctx.tools.register({
    name: 'plastic_memory_restore',
    description: '可塑性记忆：把记忆恢复到某次备份（不填名字就用最近一次）。恢复前会把当前状态也存一份，反悔还有退路。只有主人明确说要用备份/撤销清理时才调。',
    parameters: obj({ name: { ...str, description: '备份名字，不填=最近一次' }, scope: scopeArg }),
    output: textOutput,
    async execute(a) { return runTool(a, ['restore', ...(a.name ? [String(a.name)] : [])]) },
  })
  ctx.tools.register({
    name: 'plastic_memory_rmfolder',
    description: '可塑性记忆：删掉一个分区（子分区会一起删）。内容不是直接消失，会先写进回收站文件，主人反悔还能翻。只有在主人明确说要删分区/删掉这个文件夹时才调。',
    parameters: obj({
      folder: { ...str, description: '分区代号，如 X2 或 M>行为' },
      force: { ...str, description: '内置分区（M/P/C/R/T）要删得填 force' },
      scope: scopeArg,
    }, ['folder']),
    output: textOutput,
    async execute(a) {
      const args = ['rmfolder', String(a.folder)]
      if (a.force) args.push('force')
      return runTool(a, args)
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
    parameters: obj({ scope: scopeArg }),
    output: textOutput,
    async execute(a) { return runTool(a, ['backups']) },
  })

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  const readBody = (req) => new Promise((resolve) => {
    let s = ''
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    req.on('data', (c) => {
      s += c
      if (s.length > 1e6) { s = ''; req.destroy(); finish({}) }   // 超限就断开，别让请求挂死
    })
    req.on('end', () => { try { finish(JSON.parse(s || '{}')) } catch { finish({}) } })
    req.on('error', () => finish({}))
    req.on('aborted', () => finish({}))
  })
  ctx.webServer.register({
    kind: 'prefix',
    path: '/api/plastic-memory',
    handler: async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      const p = u.pathname.replace(/^\/api\/plastic-memory/, '')
      const qs = u.searchParams.get('scope') || 'global'
      try {
        if (p === '/emotion-deps') return json(res, 200, { ok: true, ...depChecks() })
        if (req.method === 'POST' && p === '/emotion-deps/install') {
          const r = installDeps()
          return json(res, 200, { ok: true, out: r.out, installed: r.ok, checks: depChecks() })
        }
        if (req.method === 'POST' && p === '/emotion-config') {
          const b = await readBody(req)
          const ok = writeEmoConfig({
            enabled: b.enabled === undefined ? undefined : !!b.enabled,
            votes: b.votes,
            fast: b.fast === undefined ? undefined : !!b.fast,
            retry: b.retry === undefined ? undefined : !!b.retry,
            apiBase: b.apiBase === undefined ? undefined : String(b.apiBase).trim(),
            model: b.model === undefined ? undefined : String(b.model).trim(),
            apiKey: b.apiKey === undefined ? undefined : String(b.apiKey).trim(),
          })
          // 立刻回读：让前端拿到落盘后的真实状态，而不是它自己猜的
          return json(res, 200, { ok, ...readEmoConfig(), mode: 'inline', host: hostInfo() })
        }
        if (p === '/emotion-config') {
          return json(res, 200, {
            ok: true, ...readEmoConfig(), host: hostInfo(), mode: 'inline',
          })
        }
        if (p === '/workspaces') return json(res, 200, { ok: true, workspaces: listDshWorkspaces() })
        if (p === '/scopes') return json(res, 200, { ok: true, scopes: listScopes() })
        // 当前会话属于哪个工作区、有没有建库——手动记一条时用来预选
        if (p === '/where') {
          const ws = sessionWorkspace()
          return json(res, 200, {
            ok: true,
            current: ws ? { title: ws.title, path: ws.path, hasLib: !!wsScopeOf(ws) } : null,
          })
        }
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
      const out = runIn(['rmfolder', String(b.k), ...(b.force ? ['force'] : [])], b.scope || qs)
      return json(res, 200, { ok: !/没有这个分区|找不到/.test(String(out)), out })
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
    if (req.method === 'POST' && p === '/mk') {
          const b = await readBody(req)
          const nm = String(b.name || '').trim()
          if (!nm) return json(res, 200, { ok: false, error: '给分区起个名字' })
          return json(res, 200, { ok: true, out: runIn(['mk', nm, ...(b.parent ? [String(b.parent)] : [])], b.scope || qs) })
        }
        if (req.method === 'POST' && p === '/add-now') {
          const b = await readBody(req)
          const sc = b.scope || qs
          const g = folderGuard(sc, b.folder)
          if (!g.ok) return json(res, 200, { ok: false, blocked: !g.missing, reason: g.reason, kids: g.kids || [] })
          return json(res, 200, { ok: true, out: directAdd(sc, String(b.folder), String(b.text)) })
        }
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

  // DSH Go 原生界面：只有装了 dsh-go 桥接的主机（手机本机引擎）才会进来。
  // 网页版、桌面版没有 dshGo 服务，这段直接跳过，一行都不影响。
  try {
    ctx.inject(['dshGo'], (c) => {
      try {
        registerDshGo(c, {
          listScopes,
          listFolders,
          openFolder,
          directAdd,
          readPendingList,
          homeOf,
          scopeLabel,
          runIn,
        })
      } catch (e) {
        // 原生层出错不能连累整个插件
        try { console.warn('[plastic-memory] dshGo 原生层注册失败：' + ((e && e.message) || e)) } catch {}
      }
    })
  } catch {}
}
