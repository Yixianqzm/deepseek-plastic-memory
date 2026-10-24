/**
 * DeepSeek 可塑性记忆 —— 浏览器半端
 * 设置里一页 + 会话顶栏一个入口；支持全局 / 各工作区 两套记忆
 */
window.__ModuleLoader__.load({
  id: 'deepseek-plastic-memory',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/plastic-memory'
    const q = (scope) => '?scope=' + encodeURIComponent(scope || 'global')
    const get = (p, scope) => fetch(API + p + (p.includes('?') ? '&' : q(scope))).then((r) => r.json())
    const postJson = (p, body, scope) => fetch(API + p + q(scope), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json())

    const CSS = `
      .pm-root { display: flex; flex-direction: column; gap: 10px; }
      .pm-card { border: 1px solid var(--dsw-border, #333); border-radius: 10px; overflow: hidden; }
      .pm-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; font-size: 13px; font-weight: 600; background: color-mix(in srgb, currentColor 6%, transparent); }
      .pm-badge { font-size: 11px; font-weight: 500; opacity: .7; margin-left: 6px; }
      .pm-row { display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 13px; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
      .pm-row:hover { background: color-mix(in srgb, currentColor 4%, transparent); }
      .pm-k { flex: 0 0 auto; font-size: 11px; opacity: .55; min-width: 42px; }
      .pm-t { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pm-empty { padding: 10px 12px; font-size: 12px; opacity: .45; }
      .pm-btn { border: 1px solid var(--dsw-border, #3a3a3a); background: transparent; color: inherit; border-radius: 6px; font-size: 11px; padding: 2px 8px; cursor: pointer; opacity: .85; transition: .12s; }
      .pm-btn:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
      .pm-btn.primary { border-color: #4c8bf5; color: #6aa6ff; }
      .pm-btn.primary:hover { background: rgba(76,139,245,.14); }
      .pm-form { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
      .pm-sel, .pm-inp { background: color-mix(in srgb, currentColor 5%, transparent); border: 1px solid var(--dsw-border, #3a3a3a); border-radius: 6px; color: inherit; font-size: 12px; padding: 5px 8px; outline: none; }
      .pm-inp { flex: 1 1 auto; min-width: 0; }
      .pm-inp:focus, .pm-sel:focus { border-color: #4c8bf5; }
      .pm-msg { font-size: 11px; opacity: .55; padding: 0 12px 8px; }
      .pm-scope { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent); font-size: 12px; }
      .pm-scope .pm-sel { padding: 3px 8px; font-size: 12px; }
      .pm-tabs { display: flex; flex-direction: column; gap: 2px; padding: 8px 8px 4px; }
      .pm-tab { border: none; background: transparent; color: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 7px; cursor: pointer; opacity: .7; text-align: left; display: flex; align-items: center; gap: 6px; }
      .pm-tab:hover { opacity: 1; background: color-mix(in srgb, currentColor 6%, transparent); }
      .pm-tab.on { opacity: 1; background: color-mix(in srgb, currentColor 11%, transparent); font-weight: 600; }
      .pm-tab .pm-caret { width: 12px; opacity: .6; }
      .pm-tab .pm-count { margin-left: auto; opacity: .45; font-size: 11px; }
      .pm-kids { margin: 0 0 2px 20px; padding-left: 10px; border-left: 2px solid color-mix(in srgb, currentColor 16%, transparent); display: flex; flex-direction: column; gap: 1px; }
      .pm-kids .pm-tab { font-size: 12px; opacity: .65; }
      .pm-kids .pm-tab.on { opacity: 1; }
      .pm-list { padding: 4px 6px 8px; }
      .pm-subname { opacity: .45; font-size: 11px; margin-right: 4px; }
    `
    function useCss() {
      React.useEffect(() => {
        const id = 'pm-style'
        const old = document.getElementById(id)
        if (old) old.remove()
        const s = document.createElement('style')
        s.id = id
        s.textContent = CSS
        document.head.appendChild(s)
      }, [])
    }

    function PendingBox({ scope, folders, onChanged }) {
      const [rows, setRows] = React.useState([])
      const [msg, setMsg] = React.useState('')
      const [form, setForm] = React.useState(false)
      const [k, setK] = React.useState('')
      const [text, setText] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const load = React.useCallback(async () => {
        try { const d = await get('/pending', scope); setRows(d.rows || []) }
        catch (e) { setMsg(String((e && e.message) || e)) }
      }, [scope])
      React.useEffect(() => { load() }, [load])
      React.useEffect(() => { if (!k && folders.length) setK(folders[0].k) }, [folders])
      const act = async (api, body) => {
        try {
          const r = await postJson(api, body, scope)
          setMsg(r.out || 'ok')
          await load()
          setEditing(null)
          onChanged && onChanged()
        } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      const submit = async () => {
        const t = text.trim()
        if (!t) { setMsg('先写点啥'); return }
        await act('/add-now', { folder: k, text: t })
        setText('')
        setForm(false)
      }
      return h('div', { className: 'pm-card' },
        h('div', { className: 'pm-head' },
          h('span', null, '待审批', h('span', { className: 'pm-badge' }, rows.length)),
          h('button', { className: 'pm-btn primary', onClick: () => setForm((v) => !v) }, form ? '收起' : '+ 记一条')),
        form ? h('div', { className: 'pm-form' },
          h('select', { className: 'pm-sel', value: k, onChange: (e) => setK(e.target.value) },
            folders.map((f) => h('option', { key: f.k, value: f.k }, f.parent ? f.parent + ' › ' + f.name : f.k + ' ' + f.name))),
          h('input', {
            className: 'pm-inp', placeholder: '写点什么，越短越好', value: text, autoFocus: true,
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') submit() },
          }),
          h('button', { className: 'pm-btn primary', onClick: submit }, '写入')) : null,
        msg ? h('div', { className: 'pm-msg' }, msg) : null,
        rows.length === 0
          ? h('div', { className: 'pm-empty' }, '没有待审的记忆')
          : rows.map((r) => editing === r.id
            ? h('div', { key: r.id, className: 'pm-form' },
              h('span', { className: 'pm-k' }, r.k),
              h('input', {
                className: 'pm-inp', defaultValue: r.text, autoFocus: true,
                id: 'pm-edit-' + r.id,
                onKeyDown: (e) => { if (e.key === 'Enter') act('/edit', { id: r.id, text: e.currentTarget.value }) },
              }),
              h('button', { className: 'pm-btn', onClick: () => setEditing(null) }, '取消'),
              h('button', {
                className: 'pm-btn primary',
                onClick: () => { const el = document.getElementById('pm-edit-' + r.id); act('/edit', { id: r.id, text: el && el.value }) },
              }, '存'))
            : h('div', { key: r.id, className: 'pm-row' },
              h('span', { className: 'pm-k' }, r.k),
              h('span', { className: 'pm-t', title: r.text }, r.text),
              h('button', { className: 'pm-btn', onClick: () => setEditing(r.id) }, '改'),
              h('button', { className: 'pm-btn', onClick: () => act('/reject', { id: r.id }) }, '驳'),
              h('button', { className: 'pm-btn primary', onClick: () => act('/approve', { id: r.id }) }, '采纳')))
      )
    }

    function Browser({ scope, folders, cur, setCur, reload }) {
      const [rows, setRows] = React.useState([])
      const [msg, setMsg] = React.useState('')
      const [expanded, setExpanded] = React.useState({})
      const [editingItem, setEditingItem] = React.useState(null)
      const [mkOpen, setMkOpen] = React.useState(false)
      const [mkName, setMkName] = React.useState('')
      const [mkParent, setMkParent] = React.useState('')
      const [lastBk, setLastBk] = React.useState('')
      const tops = folders.filter((f) => !f.parent)
      const subsOf = (k) => folders.filter((f) => f.parent === k)
      const loadRows = React.useCallback(async (k) => {
        if (!k) return
        try { const o = await get('/open?k=' + encodeURIComponent(k), scope); setRows(o.rows || []) }
        catch (e) { setMsg(String((e && e.message) || e)) }
      }, [scope])
      React.useEffect(() => { if (cur) loadRows(cur) }, [cur, loadRows])
      const actItem = async (api, body) => {
        try { const r = await postJson(api, body, scope); setMsg(r.out || 'ok'); setEditingItem(null); await loadRows(cur); reload && reload() }
        catch (e) { setMsg(String((e && e.message) || e)) }
      }
      const gc = async () => {
        try {
          const r = await postJson('/gc', {}, scope)
          const out = String(r.out || 'ok')
          setMsg(out)
          const m = /备份:s*(S+)/.exec(out)
          setLastBk(m ? m[1] : '')
          await loadRows(cur)
          reload && reload()
        } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      const undoGc = async () => {
        try {
          const r = await postJson('/restore', { name: lastBk, scope }, scope)
          setMsg(String(r.out || 'ok'))
          setLastBk('')
          await loadRows(cur)
          reload && reload()
        } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      const mkSubmit = async () => {
        const nm = mkName.trim()
        if (!nm) { setMsg('先起个名'); return }
        try {
          const r = await postJson('/mk', { name: nm, parent: mkParent }, scope)
          setMsg(r.out || 'ok')
          setMkName('')
          setMkOpen(false)
          reload && reload()
        } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      return h('div', { className: 'pm-card', style: { flex: 1, minWidth: 0 } },
        h('div', { className: 'pm-head' },
          h('span', null, '记忆'),
          h('span', { style: { display: 'flex', gap: 6 } },
            h('button', { className: 'pm-btn', onClick: () => setMkOpen((v) => !v) }, '+ 分区'),
            h('button', { className: 'pm-btn', onClick: gc }, '跑遗忘曲线'),
            lastBk ? h('button', { className: 'pm-btn', onClick: undoGc }, '撤销清理') : null)),
        mkOpen ? h('div', { className: 'pm-form' },
          h('select', { className: 'pm-sel', value: mkParent, onChange: (e) => setMkParent(e.target.value) },
            h('option', { value: '' }, '— 新建主分区 —'),
            tops.map((f) => h('option', { key: f.k, value: f.k }, '放进 ' + f.k + ' ' + f.name))),
          h('input', {
            className: 'pm-inp', placeholder: '分区名，例如 行为', value: mkName,
            onChange: (e) => setMkName(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') mkSubmit() },
          }),
          h('button', { className: 'pm-btn primary', onClick: mkSubmit }, '建')) : null,
        h('div', { className: 'pm-tabs' },
          tops.map((f) => {
            const kids = subsOf(f.k)
            const open = !!expanded[f.k]
            return h(React.Fragment, { key: f.k },
              h('button', {
                className: 'pm-tab' + (cur === f.k ? ' on' : ''),
                onClick: () => {
                  if (kids.length) setExpanded((e) => ({ ...e, [f.k]: !e[f.k] }))
                  setCur(f.k)
                },
              },
              h('span', { className: 'pm-caret' }, kids.length ? (open ? '▾' : '▸') : ''),
              h('span', null, f.k + ' ' + f.name),
              h('span', { className: 'pm-count' }, f.n)),
              open && kids.length ? h('div', { className: 'pm-kids' },
                kids.map((c) => h('button', {
                  key: c.k,
                  className: 'pm-tab' + (cur === c.k ? ' on' : ''),
                  onClick: () => setCur(c.k),
                },
                h('span', { className: 'pm-subname' }, f.name + ' ›'),
                h('span', null, c.name),
                h('span', { className: 'pm-count' }, c.n)))) : null)
          })),
        msg ? h('div', { className: 'pm-msg' }, msg) : null,
        h('div', { className: 'pm-list' },
          rows.length === 0
            ? h('div', { className: 'pm-empty' }, '这个分区还是空的')
            : rows.map((r) => editingItem === r.id
              ? h('div', { key: r.id, className: 'pm-form' },
                h('span', { className: 'pm-k' }, r.id),
                h('input', {
                  className: 'pm-inp', defaultValue: r.text, autoFocus: true,
                  id: 'pm-item-' + r.id,
                  onKeyDown: (e) => { if (e.key === 'Enter') actItem('/edit-item', { k: cur, id: r.id, text: e.currentTarget.value }) },
                }),
                h('button', { className: 'pm-btn', onClick: () => setEditingItem(null) }, '取消'),
                h('button', {
                  className: 'pm-btn primary',
                  onClick: () => { const el = document.getElementById('pm-item-' + r.id); actItem('/edit-item', { k: cur, id: r.id, text: el && el.value }) },
                }, '存'))
              : h('div', { key: r.id, className: 'pm-row' },
                h('span', { className: 'pm-k' }, r.id),
                h('span', { className: 'pm-t', title: r.text }, (r.flag ? r.flag + ' ' : '') + r.text),
                h('span', { className: 'pm-k', style: { textAlign: 'right', minWidth: 30 } }, r.days + 'd'),
                h('button', { className: 'pm-btn', onClick: () => setEditingItem(r.id) }, '改'),
                h('button', { className: 'pm-btn', onClick: () => actItem('/del-item', { k: cur, id: r.id }) }, '删')))))
    }

    function MemoryView() {
      useCss()
      const [scope, setScope] = React.useState('global')
      const [scopes, setScopes] = React.useState([{ id: 'global', label: '全局' }])
      const [folders, setFolders] = React.useState([])
      const [cur, setCur] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [wsOpen, setWsOpen] = React.useState(false)
      const [q, setQ] = React.useState('')
      const [hits, setHits] = React.useState(null)
      const [wsCwd, setWsCwd] = React.useState('')
      const [workspaces, setWorkspaces] = React.useState([])
      const loadScopes = React.useCallback(async () => {
        try { const sc = await get('/scopes'); setScopes(sc.scopes || [{ id: 'global', label: '全局' }]) } catch {}
      }, [])
      const loadFolders = React.useCallback(async (s) => {
        try {
          const lf = await get('/list', s || scope)
          const fs2 = (lf.folders || [])
          setFolders(fs2)
          if (!fs2.some((x) => x.k === cur)) setCur(fs2.length ? fs2[0].k : '')
        } catch (e) { setMsg(String((e && e.message) || e)) }
      }, [scope, cur])
      React.useEffect(() => { loadScopes() }, [wsOpen, loadScopes])
      React.useEffect(() => { loadFolders() }, [scope])
      React.useEffect(() => { get('/workspaces').then((d) => setWorkspaces(d.workspaces || [])).catch(() => {}) }, [wsOpen])

      const doSearch = async () => {
        const kw = q.trim()
        if (!kw) { setHits(null); return }
        try {
          const r = await get('/search?q=' + encodeURIComponent(kw), scope)
          const lines = String(r.out || '').split(String.fromCharCode(10)).filter(Boolean)
          setHits(lines[0] === '没找到' ? [] : lines)
        } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      const pickScope = (id) => { setScope(id); setCur(''); setFolders([]) }
      const addWs = async () => {
        const cwd = wsCwd.trim()
        if (!cwd) { setMsg('填个工作区路径'); return }
        try {
          const r = await postJson('/bind', { cwd })
          if (r.ok) { setMsg('已建 ' + r.label); setWsCwd(''); setWsOpen(false); await loadFolders() }
          else setMsg(r.error || '失败')
        } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      return h('div', { className: 'pm-root' },
        h('div', { className: 'pm-card' },
          h('div', { className: 'pm-scope' },
            h('span', { style: { opacity: .6 } }, '记忆库'),
            h('select', {
              className: 'pm-sel', value: scope,
              onChange: (e) => pickScope(e.target.value),
            }, scopes.map((s) => h('option', { key: s.id, value: s.id }, s.cwd ? s.label + '（' + s.cwd + '）' : s.label))),
            h('input', {
              className: 'pm-inp', placeholder: '搜记忆…', value: q, style: { flex: '1 1 160px', minWidth: 120 },
              onChange: (e) => setQ(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); if (e.key === 'Escape') { setQ(''); setHits(null) } },
            }),
            h('button', { className: 'pm-btn', onClick: doSearch }, '搜'),
            h('button', { className: 'pm-btn', onClick: () => setWsOpen((v) => !v) }, '+ 工作区'),
            msg ? h('span', { style: { opacity: .55, fontSize: 11 } }, msg) : null)),
        wsOpen ? h('div', { className: 'pm-form' },
          h('select', { className: 'pm-sel', style: { flex: 1 }, value: wsCwd, onChange: (e) => setWsCwd(e.target.value) },
            h('option', { value: '' }, '— 选一个 DSH 工作区 —'),
            workspaces.map((w) => h('option', { key: w.id, value: w.path }, (w.bound ? '✓ ' : '') + w.title + '  ' + w.path))),
          h('button', { className: 'pm-btn primary', onClick: addWs }, '建记忆库')) : null,
        hits ? h('div', { className: 'pm-card' },
          h('div', { className: 'pm-head' },
            h('span', null, '搜索「' + q.trim() + '」'),
            h('button', { className: 'pm-btn', onClick: () => { setQ(''); setHits(null) } }, '清掉')),
          hits.length === 0
            ? h('div', { className: 'pm-empty' }, '没有匹配的记忆')
            : h('div', { className: 'pm-list' }, hits.map((line, i) => h('div', { key: i, className: 'pm-row' }, h('span', { className: 'pm-t' }, line))))) : null,
        h(PendingBox, { scope, folders, onChanged: loadFolders }),
        h('div', { style: { display: 'flex', minHeight: 260 } },
          h(Browser, { scope, folders, cur, setCur, reload: () => loadFolders() })))
    }

    function Overlay({ onClose }) {
      React.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
      return h('div', {
        onClick: onClose,
        style: {
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.42)',
          backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: '24px 16px',
        },
      }, h('div', {
        onClick: (e) => e.stopPropagation(),
        style: {
          background: 'var(--dsw-bg, #1d1f23)', color: 'var(--dsw-fg, #e8e8e8)',
          borderRadius: 14, padding: 14, width: 'min(760px, 94vw)', maxHeight: '80vh',
          overflow: 'auto', border: '1px solid var(--dsw-border, #35373c)',
          boxShadow: '0 18px 50px rgba(0,0,0,.55)',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 2px' } },
        h('span', { style: { fontWeight: 600, fontSize: 14 } }, '可塑性记忆'),
        h('button', {
          onClick: onClose, className: 'pm-btn',
          style: { width: 24, height: 24, padding: 0, borderRadius: 999, lineHeight: '20px', fontSize: 14 },
        }, '×')),
      h(MemoryView, {})))
    }

    function HeaderBtn() {
      const [open, setOpen] = React.useState(false)
      const [hover, setHover] = React.useState(false)
      useCss()
      return h('span', { style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          title: '可塑性记忆',
          onClick: () => setOpen((v) => !v),
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 24, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid ' + (open ? 'rgba(76,139,245,.55)' : 'transparent'),
            background: open ? 'rgba(76,139,245,.16)' : (hover ? 'rgba(127,127,127,.14)' : 'transparent'),
            color: 'inherit', fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap', transition: 'all .12s',
          },
        }, '可塑性记忆'),
        open ? h(Overlay, { onClose: () => setOpen(false) }) : null)
    }

    function Panel() {
      return h('div', { style: { maxWidth: 780, padding: '2px 0 12px' } },
        h('div', { style: { marginBottom: 8 } },
          h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 2 } }, '可塑性记忆'),
          h('div', { style: { fontSize: 12, opacity: 0.6 } }, '分文件夹记事。7 天保留，7~30 天压缩，30 天进回收站；主人和约定不删。全局库和每个工作区各有一份。')),
        h(MemoryView, {}))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'plastic-memory', order: 26, label: '可塑性记忆' },
          () => h(Panel),
        ))
        try {
          slots.inject('conversation.session.header.actions', () => slots.register(
            { name: 'conversation.session.header.actions', id: 'plastic-memory-quick', order: 40 },
            () => h(HeaderBtn),
          ))
        } catch (e) { /* 老版本没有这个槽位就算了 */ }
      },
    }
  },
})
