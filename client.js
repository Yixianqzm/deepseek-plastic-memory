/**
 * DeepSeek 可塑性记忆 —— 浏览器半端
 * · 设置里一页「可塑性记忆」：文件夹式浏览记忆
 * · 会话顶部栏一个快捷按钮：点开浮层直接看
 */
window.__ModuleLoader__.load({
  id: 'deepseek-plastic-memory',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/plastic-memory'
    const get = (p) => fetch(API + p).then((r) => r.json())
    const post = (p) => fetch(API + p, { method: 'POST' }).then((r) => r.json())

    function Browser({ compact }) {
      const [folders, setFolders] = React.useState([])
      const [cur, setCur] = React.useState('')
      const [rows, setRows] = React.useState([])
      const [msg, setMsg] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const load = React.useCallback(async () => {
        setBusy(true)
        try {
          const d = await get('/list')
          setFolders(d.folders || [])
          const k = cur || (d.folders && d.folders[0] && d.folders[0].k) || ''
          if (k) {
            setCur(k)
            const o = await get('/open?k=' + encodeURIComponent(k))
            setRows(o.rows || [])
          }
        } catch (e) { setMsg(String(e && e.message || e)) } finally { setBusy(false) }
      }, [cur])
      React.useEffect(() => { load() }, [])
      const pick = async (k) => {
        setCur(k)
        setBusy(true)
        try { const o = await get('/open?k=' + encodeURIComponent(k)); setRows(o.rows || []) }
        catch (e) { setMsg(String(e && e.message || e)) } finally { setBusy(false) }
      }
      const gc = async () => {
        setBusy(true); setMsg('')
        try { const r = await post('/gc'); setMsg(r.out || 'ok'); await load() }
        catch (e) { setMsg(String(e && e.message || e)) } finally { setBusy(false) }
      }
      return h('div', { style: { display: 'flex', gap: 12, minHeight: compact ? 240 : 380 } },
        h('div', { style: { width: 172, flex: '0 0 172px' } },
          folders.map((f) => h('button', {
            key: f.k,
            onClick: () => pick(f.k),
            style: {
              display: 'block', width: '100%', textAlign: 'left', marginBottom: 4, padding: '6px 10px',
              border: '1px solid ' + (cur === f.k ? 'var(--dsw-accent, #4c8bf5)' : 'var(--dsw-border, #3a3a3a)'),
              borderRadius: 6, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13,
            },
          }, `${f.k} ${f.name}  ${f.n}`)),
          h('button', { onClick: gc, disabled: busy, style: { marginTop: 10, fontSize: 12, padding: '4px 10px', cursor: 'pointer' } }, '跑遗忘曲线'),
        ),
        h('div', { style: { flex: 1, minWidth: 0 } },
          msg ? h('div', { style: { fontSize: 12, opacity: 0.75, marginBottom: 6 } }, msg) : null,
          busy && !rows.length ? h('div', { style: { fontSize: 12, opacity: 0.6 } }, '读取中…')
            : rows.length === 0 ? h('div', { style: { fontSize: 12, opacity: 0.6 } }, '这个分区还是空的')
              : h('div', null, rows.map((r) => h('div', {
                key: r.id,
                style: { fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--dsw-border, #2e2e2e)' },
              }, h('span', { style: { opacity: 0.5, marginRight: 8 } }, r.id), r.flag ? r.flag + ' ' : '', r.text,
                h('span', { style: { opacity: 0.4, marginLeft: 8, fontSize: 11 } }, r.days + 'd')))),
        ),
      )
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
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        },
      }, h('div', {
        onClick: (e) => e.stopPropagation(),
        style: {
          background: 'var(--dsw-bg, #1e1e1e)', color: 'var(--dsw-fg, #e6e6e6)', borderRadius: 10,
          padding: 16, width: 'min(760px, 92vw)', maxHeight: '80vh', overflow: 'auto',
          boxShadow: '0 10px 40px rgba(0,0,0,.5)', border: '1px solid var(--dsw-border, #3a3a3a)',
        },
      }, h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 10 } },
        h('strong', null, '可塑性记忆'),
        h('button', { onClick: onClose, style: { cursor: 'pointer', background: 'transparent', color: 'inherit', border: 'none', fontSize: 16 } }, '×')),
        h(Browser, { compact: true })))
    }

    function HeaderBtn() {
      const [open, setOpen] = React.useState(false)
      return h('span', null,
        h('button', {
          title: '可塑性记忆',
          onClick: () => setOpen((v) => !v),
          style: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 15, padding: '2px 6px', color: 'inherit' },
        }, '🧠'),
        open ? h(Overlay, { onClose: () => setOpen(false) }) : null)
    }

    function Panel() {
      return h('div', { style: { padding: '4px 2px', maxWidth: 720 } },
        h('h3', { style: { margin: '0 0 4px' } }, '可塑性记忆'),
        h('div', { style: { fontSize: 12, opacity: 0.7, marginBottom: 12 } },
          '分区式长期记忆：左边选分区，右边看条目。7 天内完整保留，7~30 天压缩，30 天后进回收站；主人信息和约定不删。'),
        h(Browser, {}))
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
