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
      .pm-root { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 880px; margin: 0 auto; }

      .pm-card { border: 1px solid var(--dsw-border, #333); border-radius: 12px; overflow: hidden; background: color-mix(in srgb, currentColor 2%, transparent); }
      .pm-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; background: color-mix(in srgb, currentColor 6%, transparent); }
      .pm-badge { font-size: 11px; font-weight: 500; opacity: .65; margin-left: 6px; }

      /* 顶部工具条：一行放不下就换行，不许把别的控件挤没 */
      .pm-scope { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; font-size: 12px; }
      .pm-scope > .pm-sel { max-width: 260px; }
      .pm-scope > .pm-inp { flex: 1 1 180px; min-width: 140px; }
      .pm-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 0 14px 10px; }
      .pm-hint { font-size: 11.5px; opacity: .45; line-height: 1.7; padding: 0 2px; }

      /* 行 */
      .pm-row { display: flex; align-items: center; gap: 8px; padding: 7px 14px; font-size: 13px; border-top: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
      .pm-row:hover { background: color-mix(in srgb, currentColor 4%, transparent); }
      .pm-list { padding: 0 0 6px; }
      .pm-list > .pm-row:first-child { border-top: none; }

      /* 记忆浏览：左分区、右内容 */
      .pm-body { display: grid; grid-template-columns: 184px minmax(0, 1fr); align-items: start; }
      .pm-side { min-width: 0; align-self: stretch; border-right: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
      .pm-main { min-width: 0; display: flex; flex-direction: column; }
      .pm-main > .pm-emo:first-child { border-top: none; }
      @media (max-width: 660px) {
        .pm-body { grid-template-columns: 1fr; }
        .pm-side { border-right: none; border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
      }

      /* 情绪推理块 */
      .pm-emo-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
      .pm-emo-row > .pm-btn:last-child { margin-left: 0; }
      .pm-emo-pre { white-space: pre-wrap; font-size: 11.5px; margin: 0; opacity: .8; font-family: inherit; line-height: 1.65; }
      .pm-k { flex: 0 0 auto; font-size: 11px; opacity: .5; min-width: 40px; }
      .pm-t { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pm-empty { padding: 12px 14px; font-size: 12px; opacity: .42; }

      /* 控件 */
      .pm-btn { border: 1px solid var(--dsw-border, #3a3a3a); background: transparent; color: inherit; border-radius: 7px; font-size: 11.5px; padding: 3px 9px; cursor: pointer; opacity: .82; transition: .12s; white-space: nowrap; }
      .pm-btn:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
      .pm-btn.primary { border-color: #4c8bf5; color: #6aa6ff; }
      .pm-btn.primary:hover { background: rgba(76,139,245,.14); }
      .pm-sel, .pm-inp { background: color-mix(in srgb, currentColor 5%, transparent); border: 1px solid var(--dsw-border, #3a3a3a); border-radius: 7px; color: inherit; font-size: 12px; padding: 6px 9px; outline: none; min-height: 30px; box-sizing: border-box; }
      .pm-inp { flex: 1 1 auto; min-width: 0; }
      .pm-inp:focus, .pm-sel:focus { border-color: #4c8bf5; }
      .pm-form { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 10px 14px; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
      .pm-form > .pm-sel { max-width: 220px; flex: 0 1 auto; }
      .pm-form > .pm-inp { flex: 1 1 200px; min-width: 140px; }
      .pm-msg { font-size: 11.5px; opacity: .55; padding: 0 14px 9px; margin: 0; }

      /* 分区侧栏 */
      .pm-tabs { display: flex; flex-direction: column; gap: 2px; padding: 10px 10px 6px; }
      .pm-tab { border: none; background: transparent; color: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 8px; cursor: pointer; opacity: .7; text-align: left; display: flex; align-items: center; gap: 6px; }
      .pm-tab:hover { opacity: 1; background: color-mix(in srgb, currentColor 6%, transparent); }
      .pm-tab.on { opacity: 1; background: color-mix(in srgb, currentColor 11%, transparent); font-weight: 600; }
      .pm-tab .pm-caret { width: 12px; opacity: .6; flex: 0 0 auto; }
      .pm-tab .pm-count { margin-left: auto; opacity: .45; font-size: 11px; }
      .pm-kids { margin: 0 0 2px 18px; padding-left: 10px; border-left: 2px solid color-mix(in srgb, currentColor 16%, transparent); display: flex; flex-direction: column; gap: 1px; }
      .pm-kids .pm-tab { font-size: 12px; opacity: .65; }
      .pm-kids .pm-tab.on { opacity: 1; }
      .pm-subname { opacity: .45; font-size: 11px; margin-right: 4px; }

      .pm-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 20px; }
      .pm-dialog { width: min(560px, 92vw); max-height: 70vh; overflow: auto; background: var(--dsw-bg, #1d1f23); border: 1px solid var(--dsw-border, #35373c); border-radius: 12px; padding: 12px 14px; box-shadow: 0 18px 50px rgba(0,0,0,.55); }
      .pm-dialog-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
      .pm-dialog-meta { font-size: 11px; opacity: .5; margin-bottom: 8px; }
      .pm-dialog-body { font-size: 13px; line-height: 21px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
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

    function PendingBox({ scope, scopes, folders, onChanged }) {
      const [rows, setRows] = React.useState([])
      const [msg, setMsg] = React.useState('')
      const [form, setForm] = React.useState(false)
      const [k, setK] = React.useState('')
      const [text, setText] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [pick, setPick] = React.useState(null) // 采纳时选记忆库：{ id, target }
      const [block, setBlock] = React.useState('')  // 写进主分区被挡下的原因（弹窗）
      const [target, setTarget] = React.useState('')      // 「+ 记一条」写进哪个库
      const [tFolders, setTFolders] = React.useState(null) // 目标库的分区（换库时重取）
      const load = React.useCallback(async () => {
        try { const d = await get('/pending', scope); setRows(d.rows || []) }
        catch (e) { setMsg(String((e && e.message) || e)) }
      }, [scope])
      React.useEffect(() => { load() }, [load])
      React.useEffect(() => { if (!k && folders.length) setK(folders[0].k) }, [folders])
      // 目标库跟当前浏览库不一致时，把那个库的分区取过来
      const to = target || scope
      React.useEffect(() => {
        if (!form) return
        if (to === scope) { setTFolders(null); return }
        let dead = false
        get('/list', to).then((r) => {
          if (dead) return
          const fs2 = r.folders || []
          setTFolders(fs2)
          if (fs2.length && !fs2.some((x) => x.k === k)) setK(fs2[0].k)
        }).catch(() => { if (!dead) setTFolders([]) })
        return () => { dead = true }
      }, [form, to, scope, k])
      const pickTarget = async (id) => {
        const one = (scopes || []).find((x) => x.id === id)
        if (one && one.pending && one.cwd) {
          // 这个工作区还没建库：先建出来，再往里写
          try { await postJson('/bind', { cwd: one.cwd }, 'global') } catch (e) { setMsg(String((e && e.message) || e)) }
        }
        setTarget(id)
      }
      const act = async (api, body, sc) => {
        try {
          const r = await postJson(api, body, sc || scope)
          // 后端挡住（写进有子分区的主分区不算生效）：弹窗讲清楚，别当成成功
          if (r.blocked) { setBlock(String(r.reason || '这条路写不进去')); return false }
          setMsg(r.out || 'ok')
          await load()
          setEditing(null)
          onChanged && onChanged()
          return true
        } catch (e) { setMsg(String((e && e.message) || e)); return false }
      }
      const submit = async () => {
        const t = text.trim()
        if (!t) { setMsg('先写点啥'); return }
        const done = await act('/add-now', { folder: k, text: t }, to)
        if (!done) return   // 被挡下就保留表单和内容，别清空
        setText('')
        setForm(false)
      }
      // 只有全局一个记忆库就直接采纳；有多个先问写进哪个
      const startApprove = (r) => {
        const list = scopes && scopes.length ? scopes : [{ id: 'global', label: '全局' }]
        if (list.length <= 1) { act('/approve', { id: r.id }); return }
        setPick({ id: r.id, target: scope || list[0].id })
      }
      const confirmApprove = async (id, target) => {
        await act('/approve', { id, target })
        setPick(null)
      }
      return h('div', { className: 'pm-card' },
        h('div', { className: 'pm-head' },
          h('span', null, '待审批', h('span', { className: 'pm-badge' }, rows.length)),
          h('button', { className: 'pm-btn primary', onClick: () => setForm((v) => !v) }, form ? '收起' : '+ 记一条')),
        form ? h('div', { className: 'pm-form' },
          h('select', {
            className: 'pm-sel', value: to, onChange: (e) => pickTarget(e.target.value),
            title: '写进哪个记忆库',
          }, (scopes && scopes.length ? scopes : [{ id: 'global', label: '全局' }])
            .map((s) => h('option', { key: s.id, value: s.id }, '写入 ' + s.label))),
          h('select', { className: 'pm-sel', value: k, onChange: (e) => setK(e.target.value) },
            ((tFolders || folders).length ? (tFolders || folders) : [{ k: '', name: '（这个库还没分区）', parent: '' }])
              .map((f) => h('option', { key: f.k, value: f.k }, f.parent ? f.parent + ' › ' + f.name : f.k + ' ' + f.name))),
          h('input', {
            className: 'pm-inp', placeholder: '写点什么，越短越好', value: text, autoFocus: true,
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') submit() },
          }),
          h('button', { className: 'pm-btn primary', onClick: submit }, '写入')) : null,
        msg ? h('div', { className: 'pm-msg' }, msg) : null,
        rows.length === 0
          ? h('div', { className: 'pm-empty' }, '没有待审的记忆')
          : rows.map((r) => {
            const row = editing === r.id
              ? h('div', { key: 'e' + r.id, className: 'pm-form' },
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
              : h('div', { key: 'r' + r.id, className: 'pm-row' },
                h('span', { className: 'pm-k' }, r.k),
                h('span', { className: 'pm-t', title: r.text }, r.text),
                h('button', { className: 'pm-btn', onClick: () => setEditing(r.id) }, '改'),
                h('button', { className: 'pm-btn', onClick: () => act('/reject', { id: r.id }) }, '驳'),
                h('button', { className: 'pm-btn primary', onClick: () => startApprove(r) }, '采纳'))
            const chooser = pick && pick.id === r.id
              ? h('div', { key: 'p' + r.id, className: 'pm-form' },
                h('span', { className: 'pm-k' }, '写进'),
                h('select', {
                  className: 'pm-sel', value: pick.target,
                  onChange: (e) => setPick({ id: r.id, target: e.target.value }),
                }, (scopes && scopes.length ? scopes : [{ id: 'global', label: '全局' }])
                  .map((s) => h('option', { key: s.id, value: s.id, title: s.cwd || '' }, s.label))),
                h('button', { className: 'pm-btn', onClick: () => setPick(null) }, '取消'),
                h('button', { className: 'pm-btn primary', onClick: () => confirmApprove(r.id, pick.target) }, '写进去'))
              : null
            return h(React.Fragment, { key: r.id }, row, chooser)
          })
        ,
        block ? h('div', { className: 'pm-overlay', onClick: () => setBlock('') },
          h('div', {
            className: 'pm-dialog',
            style: { width: 'auto', padding: '18px 28px', textAlign: 'center', fontSize: 14, cursor: 'default' },
            onClick: (e) => e.stopPropagation(),
          }, '操作不合法')) : null
      )
    }

    // 情绪推理入口：右上角一个按钮，点开是独立小窗
    function EmoButton({ scope }) {
      const [on, setOn] = React.useState(true)
      const [host, setHost] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [depsOut, setDepsOut] = React.useState('')
      const [msg, setMsg] = React.useState('')
      React.useEffect(() => {
        get('/emotion-config').then((o) => {
          setOn(o.enabled !== false)
          setHost(o.host || null)
        }).catch(() => {})
      }, [scope])
      const checkDeps = async () => {
        setDepsOut('检测中…')
        try { const r = await get('/emotion-deps', scope); setDepsOut(r.out || 'ok') }
        catch (e) { setDepsOut(String((e && e.message) || e)) }
      }
      const toggle = async () => {
        const next = !on
        try {
          const r = await postJson('/emotion-config', { enabled: next }, scope)
          const real = r.enabled !== false
          setOn(real)
          setMsg(r.ok === false
            ? '没写进去（配置文件写失败）'
            : (real ? '已开启，下一轮对话开始生效' : '已关闭，下一轮对话开始生效'))
        } catch (e) { setMsg('出错：' + String((e && e.message) || e)) }
      }
      return h(React.Fragment, null,
        h('button', {
          className: 'pm-btn' + (on ? ' primary' : ''),
          onClick: () => { setMsg(''); setOpen(true) },
        }, '情绪推理'),
        open ? h('div', { className: 'pm-overlay', onClick: () => setOpen(false) },
          h('div', {
            className: 'pm-dialog', onClick: (e) => e.stopPropagation(),
            style: { width: 'min(460px, 92vw)' },
          },
            h('div', { className: 'pm-dialog-head' },
              h('span', null, '情绪推理'),
              h('button', { className: 'pm-btn', onClick: () => setOpen(false) }, '×')),
            h('div', { className: 'pm-dialog-meta' },
              on ? '开 —— 每次回话前先判一次，结果当作语境用' : '关 —— 不推理（下一轮对话开始生效）'),
            h('div', { className: 'pm-emo-row', style: { marginBottom: 10 } },
              h('button', { className: 'pm-btn' + (on ? '' : ' primary'), onClick: toggle }, on ? '关闭' : '开启'),
              h('button', { className: 'pm-btn', onClick: checkDeps }, '检测依赖')),
            h('div', { className: 'pm-dialog-meta', style: { marginBottom: 4 } },
              host
                ? '跟随会话模型：' + (host.provider ? host.provider + ' / ' : '') + (host.model || '没读到')
                : '跟随会话模型'),
            h('div', { className: 'pm-dialog-meta', style: { marginBottom: 8 } },
              '内联 —— 判据和记忆直接进提示词，不另发请求'),
            msg ? h('div', { className: 'pm-dialog-meta', style: { color: msg.indexOf('没写进去') === 0 ? '#e08080' : '#7eae7e' } }, msg) : null,
            depsOut ? h('pre', { className: 'pm-emo-pre' }, depsOut) : null)) : null)
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
      const [rmArm, setRmArm] = React.useState('')
      const [viewing, setViewing] = React.useState(null)
      const tops = folders.filter((f) => !f.parent)
      const subsOf = (k) => folders.filter((f) => f.parent === k)
      const loadRows = React.useCallback(async (k) => {
        if (!k) return
        try { const o = await get('/open?k=' + encodeURIComponent(k), scope); setRows(o.rows || []) }
        catch (e) { setMsg(String((e && e.message) || e)) }
      }, [scope])
      React.useEffect(() => { if (cur) loadRows(cur) }, [cur, loadRows])
      React.useEffect(() => {
        if (!viewing) return
        const onKey = (e) => { if (e.key === 'Escape') setViewing(null) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [viewing])
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
      const rmFolder = async () => {
        if (!cur) { setMsg('先选一个分区'); return }
        const f = folders.find((x) => x.k === cur)
        const nm = f ? f.name : cur
        if (rmArm !== cur) {
          setRmArm(cur)
          setMsg('再点一次「删分区」就真删「' + nm + '」，记忆先进回收站')
          return
        }
        setRmArm('')
        try {
          const builtin = ['M', 'P', 'C', 'R', 'T'].includes(cur)
          const r = await postJson('/rmfolder', { k: cur, force: builtin }, scope)
          setMsg(r && r.ok === false ? (r.error || '没删掉') : String((r && r.out) || '已删'))
          const left = folders.filter((x) => x.k !== cur && x.parent !== cur)
          setCur(left.length ? left[0].k : '')
          reload && reload()
        } catch (e) { setMsg('删失败：' + String((e && e.message) || e)) }
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
      return h('div', { className: 'pm-card' },
        h('div', { className: 'pm-head' },
          h('span', null, '记忆', cur ? h('span', { className: 'pm-badge' }, cur) : null),
          h('span', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('button', { className: 'pm-btn', onClick: () => setMkOpen((v) => !v) }, '+ 分区'),
            cur ? h('button', {
          className: 'pm-btn' + (rmArm === cur ? ' primary' : ''),
          onClick: rmFolder,
        }, rmArm === cur ? '真删？' : '删分区') : null,
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
        h('div', { className: 'pm-body' },
          h('div', { className: 'pm-side' },
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
          }))),
          h('div', { className: 'pm-main' },
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
                h('button', { className: 'pm-btn', onClick: () => setViewing(r) }, '查看'),
                h('button', { className: 'pm-btn', onClick: () => setEditingItem(r.id) }, '改'),
                h('button', { className: 'pm-btn', onClick: () => actItem('/del-item', { k: cur, id: r.id }) }, '删')))))),
        viewing ? h('div', { className: 'pm-overlay', onClick: () => setViewing(null) },
          h('div', { className: 'pm-dialog', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'pm-dialog-head' },
              h('span', null, '完整记忆'),
              h('button', { className: 'pm-btn', onClick: () => setViewing(null) }, '×')),
            h('div', { className: 'pm-dialog-meta' },
              (cur || '') + ' · #' + viewing.id + ' · ' + viewing.days + ' 天' + (viewing.flag ? ' · ' + viewing.flag : '')),
            h('div', { className: 'pm-dialog-body' }, viewing.text))) : null)
    }

    function MemoryView() {
      useCss()
      const [scope, setScope] = React.useState('global')
      const [scopes, setScopes] = React.useState([{ id: 'global', label: '全局' }])
      const [folders, setFolders] = React.useState([])
      const [cur, setCur] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [rmWsArm, setRmWsArm] = React.useState('')
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
      const pickScope = async (id) => {
        const one = scopes.find((x) => x.id === id)
        if (one && one.pending && one.cwd) {
          // 当前工作区还没建库：选中时先建，再切过去
          try {
            await postJson('/bind', { cwd: one.cwd }, 'global')
            const sc = await get('/scopes')
            setScopes(sc.scopes || [{ id: 'global', label: '全局' }])
          } catch (e) { setMsg(String((e && e.message) || e)) }
        }
        setScope(id); setCur(''); setFolders([]); setRmWsArm('')
      }
      const rmWs = async () => {
        if (!scope || scope === 'global') { setMsg('全局记忆库不能删'); return }
        const one = scopes.find((x) => x.id === scope)
        if (rmWsArm !== scope) {
          setRmWsArm(scope)
          setMsg('再点一次「删工作区」就真删「' + (one ? one.label : scope) + '」，会移到 ws/.deleted')
          return
        }
        setRmWsArm('')
        try {
          const r = await postJson('/rmws', { scope }, 'global')
          if (r.ok) {
            setMsg('已删，移到了 ws/.deleted')
            await loadScopes()
            pickScope('global')
            await loadFolders('global')
          } else setMsg(r.error || '没删掉')
        } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      const addWs = async () => {
        const cwd = wsCwd.trim()
        if (!cwd) { setMsg('填个工作区路径'); return }
        try {
          const r = await postJson('/bind', { cwd })
          if (r.ok) {
            setMsg('已建 ' + r.label + (r.folders ? '，默认 ' + r.folders + ' 个分区已建好' : ''))
            setWsCwd(''); setWsOpen(false)
            await loadScopes()
            // 建完直接切过去，不然还停在原来那个库上，看着像没反应
            if (r.id) { await pickScope(r.id); await loadFolders(r.id) }
            else await loadFolders()
          } else setMsg(r.error || '失败')
        } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      return h('div', { className: 'pm-root' },
        h('div', { className: 'pm-hint' },
          '小提示：觉得有必要的时候，或者在开新会话之前，先让 DSH 把当前记忆总结一遍。'),
        h('div', { className: 'pm-card' },
          h('div', { className: 'pm-scope' },
            h('span', { style: { fontSize: 11, opacity: .45, flex: '0 0 auto' } }, '记忆库'),
            h('select', {
              className: 'pm-sel', value: scope, title: '切换记忆库',
              onChange: (e) => pickScope(e.target.value),
            }, scopes.map((s) => h('option', { key: s.id, value: s.id, title: s.cwd || s.home || '' }, s.label))),
            h('input', {
              className: 'pm-inp', placeholder: '搜记忆…', value: q,
              onChange: (e) => setQ(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); if (e.key === 'Escape') { setQ(''); setHits(null) } },
            }),
            h('button', { className: 'pm-btn', onClick: doSearch }, '搜'),
            h('button', { className: 'pm-btn', onClick: () => setWsOpen((v) => !v) }, wsOpen ? '取消' : '+ 工作区'),
            scope !== 'global' ? h('button', {
              className: 'pm-btn' + (rmWsArm === scope ? ' primary' : ''),
              onClick: rmWs,
            }, rmWsArm === scope ? '真删？' : '删工作区') : null),
          (() => {
            const one = scopes.find((x) => x.id === scope)
            const line = one && one.cwd ? one.cwd : (one && one.home ? one.home : '')
            // 这一行：左边是路径 / 提示，右边是「情绪推理」入口
            return h('div', { className: 'pm-tools' },
              line ? h('span', { style: { fontSize: 11, opacity: .38, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' } }, line) : null,
              msg ? h('span', { style: { fontSize: 11, opacity: .55 } }, msg) : null,
              h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center' } },
                h(EmoButton, { scope })))
          })(),
          wsOpen ? h('div', { className: 'pm-form' },
            h('select', {
              className: 'pm-sel', style: { flex: '1 1 240px' }, value: wsCwd,
              onChange: (e) => setWsCwd(e.target.value),
            },
            h('option', { value: '' }, '— 选一个 DSH 工作区 —'),
            workspaces.map((w) => h('option', { key: w.id, value: w.path }, (w.bound ? '✓ ' : '') + w.title))),
            h('button', { className: 'pm-btn primary', onClick: addWs }, '建记忆库')) : null),
        hits ? h('div', { className: 'pm-card' },
          h('div', { className: 'pm-head' },
            h('span', null, '搜索「' + q.trim() + '」'),
            h('button', { className: 'pm-btn', onClick: () => { setQ(''); setHits(null) } }, '清掉')),
          hits.length === 0
            ? h('div', { className: 'pm-empty' }, '没有匹配的记忆')
            : h('div', { className: 'pm-list' }, hits.map((line, i) => h('div', { key: i, className: 'pm-row' }, h('span', { className: 'pm-t' }, line))))) : null,
        h(PendingBox, { scope, scopes, folders, onChanged: loadFolders }),
        h(Browser, { scope, folders, cur, setCur, reload: () => loadFolders() }))
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
          borderRadius: 14, padding: '16px 18px', width: 'min(920px, 94vw)', maxHeight: '82vh',
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
      const [hoverSky, setHoverSky] = React.useState(false)
      useCss()
      const openSky = () => {
        fetch('/api/memory-sky/open', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'global' }),
        }).catch(() => {})
      }
      const base = {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: 24, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
        color: 'inherit', fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap', transition: 'all .12s',
      }
      return h('span', { style: { position: 'relative', display: 'inline-flex', gap: 6 } },
        h('button', {
          title: '可塑性记忆',
          onClick: () => setOpen((v) => !v),
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            ...base,
            border: '1px solid ' + (open ? 'rgba(76,139,245,.55)' : 'transparent'),
            background: open ? 'rgba(76,139,245,.16)' : (hover ? 'rgba(127,127,127,.14)' : 'transparent'),
          },
        }, '可塑性记忆'),
        h('button', {
          title: '打开记忆星空（本地 Edge）',
          onClick: openSky,
          onMouseEnter: () => setHoverSky(true),
          onMouseLeave: () => setHoverSky(false),
          style: {
            ...base,
            border: '1px solid transparent',
            background: hoverSky ? 'rgba(127,127,127,.14)' : 'transparent',
          },
        }, '记忆星空'),
        open ? h(Overlay, { onClose: () => setOpen(false) }) : null)
    }

    function Panel() {
      const openSky = () => {
        fetch('/api/memory-sky/open', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'global' }),
        }).catch(() => {})
      }
      return h('div', { style: { maxWidth: 880, padding: '2px 0 12px' } },
        h('div', { style: { marginBottom: 8, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } },
          h('div', null,
            h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 2 } }, '可塑性记忆'),
            h('div', { style: { fontSize: 12, opacity: 0.6 } }, '分文件夹记事。7 天保留，7~30 天压缩，30 天进回收站；主人和约定不删。全局库和每个工作区各有一份。')),
          h('button', { className: 'pm-btn primary', onClick: openSky, style: { flex: '0 0 auto', marginTop: 2 } }, '记忆星空')),
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
