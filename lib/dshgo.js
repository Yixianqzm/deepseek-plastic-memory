/**
 * DSH Go 原生界面层（手机 App 专用）
 *
 * 只做两件事：
 *   1. 把已有的记忆数据（index.js 那套文件格式与函数）翻成 App 能画的 JSON 视图；
 *   2. 把 App 里点按翻成对同一份数据的读写。
 *
 * 没有 dsh-go 桥接的主机不会加载这里，网页版一行都不受影响。
 * 协议见 dsh-go/docs/plugins（清单 dshGo.v = 1，视图 v2）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_FOLDERS = 20
const MAX_ROWS = 40
const MAX_TITLE = 42

const clip = (s, n = MAX_TITLE) => {
  const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return v.length > n ? v.slice(0, n - 1) + '…' : v
}

/** 每个面板实例（按会话）各自记着自己翻到了哪 */
const stores = new Map()
function storeOf(scope) {
  const key = (scope && scope.sessionId) || 'global'
  let s = stores.get(key)
  if (!s) {
    s = { scope: 'global', folder: '', sel: '', mode: 'browse', confirm: '' }
    stores.set(key, s)
  }
  return s
}

export function registerDshGo(ctx, api) {
  const { listFolders, openFolder, directAdd, readPendingList, homeOf, scopeLabel, runIn } = api

  const allLibs = () => {
    try { return api.listScopes() || [] } catch { return [{ id: 'global', label: '全局' }] }
  }

  function stats(scopeId, st) {
    let folders = []
    try { folders = (listFolders(scopeId) || {}).folders || [] } catch { folders = [] }
    const total = folders.reduce((a, f) => a + (f.n || 0), 0)
    let pending = 0
    try { pending = (readPendingList(scopeId) || []).length } catch { pending = 0 }
    if (!st.folder && folders.length) st.folder = folders[0].k
    if (st.folder && !folders.some((f) => f.k === st.folder)) st.folder = folders.length ? folders[0].k : ''
    let label = scopeId
    try { label = scopeLabel(scopeId) || scopeId } catch {}
    return { folders, total, pending, label, libs: allLibs() }
  }

  function rowsOf(scopeId, k) {
    try {
      const o = openFolder(scopeId, k)
      return o && o.ok ? (o.rows || []) : []
    } catch { return [] }
  }

  function setPin(scopeId, k, id, on) {
    try {
      const p = join(homeOf(scopeId), k, 'notes.md')
      if (!existsSync(p)) return false
      const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
      let hit = false
      const out = lines.map((l) => {
        const parts = l.split('|')
        if (parts[0] !== id) return l
        hit = true
        return [parts[0], parts[1], on ? '*' : '', ...parts.slice(3)].join('|')
      })
      if (!hit) return false
      writeFileSync(p, out.join('\n') + '\n', 'utf8')
      return true
    } catch { return false }
  }

  const folderName = (folders, k) => {
    const f = (folders || []).find((x) => x.k === k)
    return f ? f.name : k
  }

  /* ---------------- 视图 ---------------- */

  function buildView(scope) {
    const st = storeOf(scope)
    const { folders, total, pending, label, libs } = stats(st.scope, st)
    const kids = new Map()
    for (const f of folders) if (f.parent) kids.set(f.parent, (kids.get(f.parent) || 0) + 1)

    const children = [
      { type: 'keyValue', items: [['记忆库', label], ['总条数', total], ['待审', pending]] },
      { type: 'divider' },
    ]

    if (st.mode === 'item' && st.sel) {
      const row = rowsOf(st.scope, st.folder).find((r) => String(r.id) === String(st.sel))
      children.push({
        type: 'stack',
        children: [
          { type: 'text', text: row ? row.text : '这条已经没了' },
          {
            type: 'keyValue',
            items: [
              ['分区', folderName(folders, st.folder)],
              ['存放', row ? row.days + ' 天' : '-'],
              ['状态', row && row.flag === '*' ? '已固定' : '会淡忘'],
            ],
          },
          st.confirm === 'del'
            ? { type: 'confirm', id: 'delYes', confirmLabel: '确认删除', cancelLabel: '算了' }
            : {
                type: 'actions',
                items: [
                  row && row.flag === '*' ? { label: '取消固定', action: 'unpin' } : { label: '固定住', action: 'pin' },
                  { label: '删除', action: 'askDel' },
                  { label: '返回', action: 'back', style: 'plain' },
                ],
              },
        ],
      })
      return wrap(children)
    }

    if (st.mode === 'add') {
      const opts = folders.slice(0, 24).map((f) => ({
        label: (f.parent ? '　' + folderName(folders, f.parent) + ' › ' : '') + f.name,
        value: f.k,
      }))
      children.push({
        type: 'form',
        submit: 'save',
        submitLabel: '记下来',
        children: [
          {
            type: 'textField', label: '内容', bind: 'data.form.text',
            multiline: true, maxLines: 5, required: true, maxLength: 400,
            placeholder: '* 开头算重要',
          },
          { type: 'select', label: '放到哪一块', bind: 'data.form.folder', options: opts },
          { type: 'text', text: '写进去就生效。想让模型自己记，让它调工具。', tone: 'muted' },
        ],
      })
      children.push({ type: 'actions', items: [{ label: '取消', action: 'back', style: 'plain' }] })
      return wrap(children)
    }

    if (libs.length > 1) {
      children.push({
        type: 'options', id: 'scope', label: '记忆库',
        options: libs.slice(0, 24).map((x) => ({ label: x.label || x.id, value: x.id })),
        selected: st.scope,
      })
      children.push({ type: 'divider' })
    }

    children.push({
      type: 'list',
      items: folders.slice(0, MAX_FOLDERS).map((f) => ({
        title: f.name,
        subtitle: kids.get(f.k) ? kids.get(f.k) + ' 个子分区' : undefined,
        trailing: String(f.n || 0),
        icon: f.parent ? 'note' : 'folder',
        action: { id: 'pick', args: { k: f.k } },
      })),
    })

    if (st.folder) {
      const list = rowsOf(st.scope, st.folder)
      children.push({ type: 'divider' })
      children.push({ type: 'text', text: folderName(folders, st.folder) + ' · ' + list.length + ' 条', tone: 'muted' })
      if (!list.length) {
        children.push({ type: 'text', text: '这块还空着。', tone: 'muted' })
      } else {
        children.push({
          type: 'list',
          items: list.slice(0, MAX_ROWS).map((r) => ({
            title: clip(r.text),
            subtitle: (r.flag === '*' ? '固定 · ' : '') + r.days + ' 天前',
            tone: r.days >= 30 ? 'bad' : r.days >= 7 ? 'warn' : undefined,
            icon: r.flag === '*' ? 'pin' : 'note',
            action: { id: 'openMem', args: { id: String(r.id) } },
          })),
        })
        if (list.length > MAX_ROWS) {
          children.push({ type: 'text', text: '还有 ' + (list.length - MAX_ROWS) + ' 条，去网页版看全部。', tone: 'muted' })
        }
      }
    }

    children.push({
      type: 'actions',
      items: [
        { label: '记一条', action: 'addStart', style: 'primary' },
        { label: '刷新', action: 'reload', style: 'plain' },
      ],
    })
    return wrap(children)
  }

  const wrap = (children) => ({ v: 2, type: 'stack', children })

  /* ---------------- 注册 ---------------- */

  ctx.dshGo.panel('memory', {
    view: (scope) => buildView(scope),
    data: (scope, emit) => {
      const st = storeOf(scope)
      const { folders } = stats(st.scope, st)
      emit({ form: { text: '', folder: st.folder || (folders[0] && folders[0].k) || '' } })
    },
    actions: {
      reload: () => ({ refresh: true }),
      back: (scope) => {
        const st = storeOf(scope)
        st.mode = 'browse'
        st.sel = ''
        st.confirm = ''
        return { refresh: true }
      },
      addStart: (scope) => {
        const st = storeOf(scope)
        st.mode = 'add'
        st.sel = ''
        st.confirm = ''
        return { refresh: true }
      },
      pick: (scope, event) => {
        const st = storeOf(scope)
        st.folder = String((event.value && event.value.k) || '')
        st.mode = 'browse'
        st.sel = ''
        return { refresh: true }
      },
      openMem: (scope, event) => {
        const st = storeOf(scope)
        st.sel = String((event.value && event.value.id) || '')
        st.mode = 'item'
        st.confirm = ''
        return { refresh: true }
      },
      pin: (scope) => {
        const st = storeOf(scope)
        return { refresh: true, toast: setPin(st.scope, st.folder, st.sel, true) ? '已固定' : '没找到这条' }
      },
      unpin: (scope) => {
        const st = storeOf(scope)
        return { refresh: true, toast: setPin(st.scope, st.folder, st.sel, false) ? '已取消固定' : '没找到这条' }
      },
      askDel: (scope) => {
        storeOf(scope).confirm = 'del'
        return { refresh: true }
      },
      delYes: (scope, event) => {
        const st = storeOf(scope)
        if (!event.value || event.value.confirmed !== true) {
          st.confirm = ''
          return { refresh: true }
        }
        let out = ''
        try { out = runIn(['rm', st.folder, String(st.sel), 'force'], st.scope) } catch (e) { out = String((e && e.message) || e) }
        st.confirm = ''
        st.mode = 'browse'
        st.sel = ''
        return { refresh: true, toast: /ok|删/i.test(String(out)) ? '已删掉，进回收站' : clip(out, 30) }
      },
      scope: (scope, event) => {
        const st = storeOf(scope)
        const v = String((event.value && event.value.value) || '')
        if (!v) return undefined
        st.scope = v
        st.folder = ''
        st.sel = ''
        st.mode = 'browse'
        return { refresh: true }
      },
      save: (scope, event) => {
        const st = storeOf(scope)
        const values = (event.value && event.value.values) || {}
        const body = values['data.form.text']
        const folder = String(values['data.form.folder'] || st.folder || '')
        if (typeof body !== 'string' || !body.trim()) return { toast: '内容不能空' }
        let out = ''
        try { out = directAdd(st.scope, folder, body) } catch (e) { out = String((e && e.message) || e) }
        if (!String(out).startsWith('ok')) return { toast: clip(out, 30) }
        st.mode = 'browse'
        st.folder = folder
        return { refresh: true, toast: '记下了' }
      },
    },
  })

  ctx.dshGo.strip('memory-stat', (scope, emit) => {
    const st = storeOf(scope)
    const push = () => {
      try {
        const { total, pending } = stats(st.scope, st)
        emit({ text: '记忆 ' + total + ' · 待审 ' + pending, icon: 'bookmark' })
      } catch { emit({ text: '记忆', icon: 'bookmark' }) }
    }
    push()
    const timer = setInterval(push, 60000)
    if (timer && typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  })
}
