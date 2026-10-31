/**
 * 记忆星空 —— WebGL 星系
 * 主星云 = 主分区，副星辰 = 子分区，小点是单条记忆。
 * 画面全在显卡上跑；页面只读本机的可塑性记忆数据，不发任何模型请求。
 */
import * as THREE from './vendor/three.module.js'

const $ = (id) => document.getElementById(id)
const API = '/api/memory-sky'

const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt))
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const rnd = (seed) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
let toastTimer = 0
function toast(text, kind = '') {
  const el = $('toast')
  el.textContent = text
  el.className = 'glass show ' + kind
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.className = 'glass' }, 2200)
}

const API_BASE = API

/* ---------------- 状态 ---------------- */
const state = {
  scope: 'global',
  scopes: [],
  folders: [],
  memories: [],
  sel: null,          // { kind:'main'|'sub'|'mem', k, id }
  editing: false,
  viewingMem: null,   // 正在看详情的记忆
  query: '',
  matches: new Set(),
  pinnedOnly: false,
  bandView: null,     // { kind:'fading'|'forgotten', folderName }
  demo: { on: false, gear: 40, clean: false },
  theme: (() => {
    try {
      const q = new URLSearchParams(location.search).get('theme')
      if (q === 'starburst' || q === 'nebula' || q === 'neuron') return q
      const saved = localStorage.getItem('memory-sky-theme')
      if (saved === 'starburst' || saved === 'nebula' || saved === 'neuron') return saved
    } catch {}
    return 'nebula'
  })(),
}

/* ---------------- Three ---------------- */
const canvas = $('sky')
let renderer, scene, camera
let dust, threads, threadMat
const mains = new Map()      // k -> { group, sprite, label, pos, subs:[] }
const subs = new Map()       // k -> { group, sprite, label, parentK, pos }
const mems = new Map()       // id -> { sprite, base, op, pos, folder }
const pickables = []         // { kind, k, id, object3d }
const labelNodes = []        // 需要按距离缩放标签的节点
const tmpWorld = new THREE.Vector3()
let hotRanges = new Map()    // memoryId -> [{start,count}]
const hotAttr = { array: null, needsUpdate: false }
let threadGeo = null

const cam = { yaw: 0.62, pitch: 0.5, dist: 118, tx: 0, ty: 0, tz: 0 }
const camCur = { yaw: 0.62, pitch: 0.5, dist: 118, tx: 0, ty: 0, tz: 0 }
const fit = { dist: 46 }
let hovered = null
let drag = null
let moved = 0
let lastT = 0

const PALETTE = [
  [0.82, 0.88, 1.0], [1.0, 0.94, 0.84], [0.86, 0.92, 1.0],
  [0.96, 0.92, 0.9], [0.9, 0.96, 1.0], [1.0, 0.97, 0.9],
  [0.88, 0.9, 1.0], [0.94, 0.96, 1.0],
]

function radialTexture(power = 2.3, size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    grad.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, power).toFixed(4)})`)
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function ringTexture(size = 192) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const cx = size / 2
  g.strokeStyle = 'rgba(170,205,255,0.85)'
  g.lineWidth = size * 0.012
  g.beginPath(); g.arc(cx, cx, size * 0.4, 0, Math.PI * 2); g.stroke()
  g.strokeStyle = 'rgba(220,235,255,0.95)'
  g.lineWidth = size * 0.02
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    g.beginPath(); g.arc(cx, cx, size * 0.4, a, a + 0.13); g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function textSprite(text, { size = 34, color = '#dfe6ff', glow = 8, opacity = 0.95 } = {}) {
  const pad = 14
  const c = document.createElement('canvas')
  const ctx0 = c.getContext('2d')
  const font = `500 ${size}px "Microsoft YaHei UI","Microsoft YaHei",-apple-system,Segoe UI,sans-serif`
  ctx0.font = font
  c.width = Math.ceil(ctx0.measureText(text).width) + pad * 2
  c.height = size + pad * 2
  const g = c.getContext('2d')
  g.font = font
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = 'rgba(0,0,0,0.95)'
  g.shadowBlur = 14
  g.fillStyle = 'rgba(0,0,0,0.75)'
  g.globalAlpha = opacity
  g.fillText(text, c.width / 2, c.height / 2)
  g.shadowBlur = 4
  g.shadowColor = color
  g.fillStyle = color
  g.fillText(text, c.width / 2, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity }))
  sp.scale.set(c.width * 0.014, c.height * 0.014, 1)
  sp.renderOrder = 60
  sp.userData.base = opacity
  sp.userData.perInstance = true
  return sp
}

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  renderer.setClearColor(0x03050c, 1)
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 3200)
  initPost()
  buildSky(state.theme)
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    resizePost()
  })
}

/* ---------------- 后期：泛光 + 色调映射 + 暗角，做出震撼感 ---------------- */
let rtScene = null
let rtBlurA = null
let rtBlurB = null
let quadScene = null
let quadCam = null
let quadMesh = null
let matBright = null
let matBlur = null
let matPost = null
const postUniforms = { uBloom: 0.34, uVignette: 0.55 }

function initPost() {
  const size = new THREE.Vector2()
  renderer.getDrawingBufferSize(size)
  const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
  rtScene = new THREE.WebGLRenderTarget(size.x, size.y, opt)
  rtBlurA = new THREE.WebGLRenderTarget(Math.max(2, size.x >> 1), Math.max(2, size.y >> 1), opt)
  rtBlurB = new THREE.WebGLRenderTarget(Math.max(2, size.x >> 1), Math.max(2, size.y >> 1), opt)

  quadScene = new THREE.Scene()
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null)
  quadMesh.frustumCulled = false
  quadScene.add(quadMesh)

  const vert = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `

  matBright = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.72 } },
    vertexShader: vert,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uThreshold;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = max(c.r, max(c.g, c.b));
        float k = max(0.0, l - uThreshold) / max(l, 1e-4);
        gl_FragColor = vec4(c * k, 1.0);
      }
    `,
  })

  matBlur = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
    vertexShader: vert,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec2 uDir;
      void main() {
        vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
        s += texture2D(tDiffuse, vUv + uDir * 1.384615).rgb * 0.316216;
        s += texture2D(tDiffuse, vUv - uDir * 1.384615).rgb * 0.316216;
        s += texture2D(tDiffuse, vUv + uDir * 3.230769).rgb * 0.070270;
        s += texture2D(tDiffuse, vUv - uDir * 3.230769).rgb * 0.070270;
        gl_FragColor = vec4(s, 1.0);
      }
    `,
  })

  matPost = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      tBloom: { value: null },
      uBloom: { value: postUniforms.uBloom },
      uVignette: { value: postUniforms.uVignette },
    },
    vertexShader: vert,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tScene;
      uniform sampler2D tBloom;
      uniform float uBloom;
      uniform float uVignette;
      void main() {
        vec3 base = texture2D(tScene, vUv).rgb;
        vec3 bloom = texture2D(tBloom, vUv).rgb;
        vec3 col = base * 1.06 + bloom * uBloom;
        col = vec3(1.0) - exp(-col * 1.75);
        col = pow(col, vec3(0.92));
        vec2 p = vUv - 0.5;
        float v = 1.0 - dot(p, p) * uVignette;
        col *= clamp(v, 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

function resizePost() {
  const size = new THREE.Vector2()
  renderer.getDrawingBufferSize(size)
  rtScene.setSize(size.x, size.y)
  rtBlurA.setSize(Math.max(2, size.x >> 1), Math.max(2, size.y >> 1))
  rtBlurB.setSize(Math.max(2, size.x >> 1), Math.max(2, size.y >> 1))
}

function renderFrame() {
  renderer.setRenderTarget(rtScene)
  renderer.clear()
  renderer.render(scene, camera)

  quadMesh.material = matBright
  matBright.uniforms.tDiffuse.value = rtScene.texture
  renderer.setRenderTarget(rtBlurA)
  renderer.render(quadScene, quadCam)

  quadMesh.material = matBlur
  // 三次乒乓模糊，半径铺开，光晕才是"晕"而不是重影
  let src = rtBlurA
  let dst = rtBlurB
  for (let i = 0; i < 3; i++) {
    matBlur.uniforms.tDiffuse.value = src.texture
    matBlur.uniforms.uDir.value.set((1.2 + i * 1.1) / rtBlurA.width, 0)
    renderer.setRenderTarget(dst)
    renderer.render(quadScene, quadCam)

    matBlur.uniforms.tDiffuse.value = dst.texture
    matBlur.uniforms.uDir.value.set(0, (1.2 + i * 1.1) / rtBlurB.height)
    renderer.setRenderTarget(src)
    renderer.render(quadScene, quadCam)
  }

  matPost.uniforms.uBloom.value = postUniforms.uBloom * (0.97 + 0.04 * Math.sin(performance.now() * 0.00035))
  renderer.setRenderTarget(null)
  renderer.clear()
  quadMesh.material = matPost
  matPost.uniforms.tScene.value = rtScene.texture
  matPost.uniforms.tBloom.value = rtBlurA.texture
  renderer.setRenderTarget(null)
  renderer.render(quadScene, quadCam)
}


function buildDust() {
  const count = 2200
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const r = 70 + rnd(i * 3.1) * 150
    const th = rnd(i * 7.7) * Math.PI * 2
    const ph = Math.acos(2 * rnd(i * 5.3) - 1)
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th)
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.7
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th)
    seed[i] = rnd(i * 11.3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  dust = new THREE.Points(geo, pointMaterial())
  dust.frustumCulled = false
  scene.add(dust)
}

/* ---------------- 纯程序化三维星云：全部由着色器现算，没有一张贴图 ---------------- */
let skyRig = new THREE.Group()
const cloudMeshes = []

const THEMES = {
  nebula: { label: '星野', pitch: 0.26, dist: 108, kind: 'nebula' },
  starburst: { label: '恒星暴', pitch: 0.4, dist: 150, kind: 'galaxy' },
  neuron: { label: '神经云', pitch: 0.34, dist: 150, kind: 'neuron' },
}

/** 云气着色器：fbm 噪声 + 径向衰减，出来是有丝缕感的星云而不是光斑 */
function cloudMaterial(colorA, colorB, seed, opacity, dust = false) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true,
    blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: {
      uSeed: { value: seed },
      uRot: { value: seed * 1.7 },
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(colorA[0], colorA[1], colorA[2]) },
      uColorB: { value: new THREE.Color(colorB[0], colorB[1], colorB[2]) },
      uOpacity: { value: opacity },
      uDust: { value: dust ? 1 : 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      uniform float uSeed, uRot, uTime, uOpacity, uDust;
      uniform vec3 uColorA, uColorB;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.55;
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p *= 2.03;
          a *= 0.5;
        }
        return v;
      }
      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float ca = cos(uRot), sa = sin(uRot);
        vec2 q = mat2(ca, -sa, sa, ca) * p * 3.4 + vec2(uSeed, uSeed * 1.7);
        float n = fbm(q + fbm(q * 1.7 + uTime * 0.01) * 0.6);
        // 轮廓只由半径决定（一路缓降到 0），噪声只负责浓淡 —— 不会切出"海岸线"
        float fall = pow(1.0 - smoothstep(0.0, 1.0, r), 1.7);
        float wisp = fall * (0.5 + 0.5 * smoothstep(0.1, 1.0, n));
        vec3 col = mix(uColorA, uColorB, clamp(n * 1.25, 0.0, 1.0));
        gl_FragColor = vec4(col, wisp * uOpacity);
      }
    `,
  })
}

function addCloudMesh(colorA, colorB, seed, opacity, size, x, y, z, dust = false) {
  const geo = new THREE.CircleGeometry(0.5, 32)
  const mat = cloudMaterial(colorA, colorB, seed, opacity, dust)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.scale.setScalar(size)
  mesh.position.set(x, y, z)
  mesh.renderOrder = dust ? -5 : 1
  skyRig.add(mesh)
  cloudMeshes.push(mesh)
  return mesh
}

/** 星点：自带色温与闪烁 */
function starField(count, rMin, rMax, sizeK) {
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  const siz = new Float32Array(count)
  const sd = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const r = rMin + Math.pow(rnd(i * 3.7), 1.3) * (rMax - rMin)
    const th = rnd(i * 7.7) * Math.PI * 2
    const ph = Math.acos(2 * rnd(i * 5.3) - 1)
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * r
    pos[i * 3 + 1] = Math.cos(ph) * r * 0.85
    pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r
    const t = rnd(i * 11.3)
    col[i * 3] = 0.7 + t * 0.3
    col[i * 3 + 1] = 0.78 + t * 0.18
    col[i * 3 + 2] = 1.0 - t * 0.32
    siz[i] = sizeK * (0.5 + rnd(i * 13.1) * 1.4)
    sd[i] = rnd(i * 17.9)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1))
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aSeed;
      uniform float uTime; uniform float uPixel;
      varying vec3 vC; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.8 + 0.2 * sin(uTime * 0.9 + aSeed * 60.0);
        vC = aColor; vA = tw * (0.5 + 0.5 * aSeed);
        gl_PointSize = aSize * uPixel * (420.0 / max(-mv.z, 1.0));
      }
    `,
    fragmentShader: `
      varying vec3 vC; varying float vA;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vC, a * a * vA);
      }
    `,
  })
  const pts = new THREE.Points(g, m)
  pts.frustumCulled = false
  skyRig.add(pts)
  return m
}

/** 亮星的十字星芒，同样用着色器画 */
function spikeStar(x, y, z, size, warm) {
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(warm ? 1.0 : 0.8, warm ? 0.92 : 0.9, warm ? 0.76 : 1.0) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform vec3 uColor;
      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p);
        float win = smoothstep(0.5, 0.12, r);       // 边缘彻底归零，不留方框
        float core = exp(-dot(p, p) * 240.0);
        float rayH = exp(-abs(p.y) * 200.0) * exp(-abs(p.x) * 5.5);
        float rayV = exp(-abs(p.x) * 200.0) * exp(-abs(p.y) * 5.5);
        float a = core + (rayH + rayV) * 0.5;
        gl_FragColor = vec4(uColor, clamp(a * win, 0.0, 1.0) * 0.85);
      }
    `,
  })
  const m = new THREE.Mesh(geo, mat)
  m.scale.setScalar(size * 0.92)
  m.position.set(x, y, z)
  m.renderOrder = 2
  skyRig.add(m)
  cloudMeshes.push(m)
}

/** 星野：深空蓝底 + 铁锈色尘埃 + 玫红星云 + 大量亮星，对照第一张参考 */
function buildNebulaSky() {
  starField(11000, 130, 380, 1.15)
  starField(5200, 380, 760, 0.85)

  const palettes = [
    [[0.10, 0.28, 1.0], [0.45, 0.66, 1.0]],
    [[0.62, 0.22, 0.09], [1.0, 0.56, 0.26]],
    [[1.0, 0.26, 0.40], [1.0, 0.64, 0.70]],
    [[0.10, 0.72, 0.96], [0.58, 0.96, 1.0]],
    [[1.0, 0.60, 0.20], [1.0, 0.88, 0.58]],
    [[0.42, 0.16, 0.86], [0.82, 0.52, 1.0]],
  ]

  for (let c = 0; c < 7; c++) {
    const pal = palettes[c % palettes.length]
    const ang = rnd(c * 4.1) * Math.PI * 2
    const rad = 110 + rnd(c * 2.7) * 150
    const cx = Math.cos(ang) * rad
    const cy = (rnd(c * 6.3) - 0.5) * 95
    const cz = Math.sin(ang) * rad
    addCloudMesh(pal[1], pal[0], rnd(c * 3.3) * 10, 0.42, 70 + rnd(c) * 48, cx, cy, cz)
    for (let i = 0; i < 9; i++) {
      const a = rnd(c * 9 + i) * Math.PI * 2
      const rr = Math.pow(rnd(c * 3 + i * 1.3), 0.6) * 82
      addCloudMesh(
        pal[0], pal[1],
        rnd(i * 2.7 + c) * 10,
        0.18 + rnd(i + c) * 0.16,
        48 + rnd(i * 4.1) * 92,
        cx + Math.cos(a) * rr,
        cy + (rnd(i * 5.9) - 0.5) * 62,
        cz + Math.sin(a) * rr,
      )
    }
  }

  // 暖色薄雾：只加光不压暗，避免出现暗片切出的硬边
  for (let i = 0; i < 6; i++) {
    const a = rnd(i * 3.9) * Math.PI * 2
    const rr = 90 + rnd(i * 5.1) * 150
    addCloudMesh([0.55, 0.26, 0.12], [1.0, 0.62, 0.32], rnd(i * 7.3) * 10,
      0.045 + rnd(i) * 0.035,
      120 + rnd(i * 2.3) * 110,
      Math.cos(a) * rr, (rnd(i * 8.1) - 0.5) * 80, Math.sin(a) * rr)
  }

  for (let i = 0; i < 22; i++) {
    const a = rnd(i * 4.9) * Math.PI * 2
    const r = 110 + rnd(i * 8.1) * 240
    spikeStar(Math.cos(a) * r, (rnd(i * 3.7) - 0.5) * 180, Math.sin(a) * r,
      30 + rnd(i * 6.1) * 42, rnd(i * 2.2) > 0.55)
  }
}

/** 恒星暴：金白核 + 蓝白外环 + 玫红星爆团 + 尘埃，对照第二张参考 */
function buildGalaxySky() {
  const count = 46000
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  const siz = new Float32Array(count)
  const sd = new Float32Array(count)
  const arms = 2
  for (let i = 0; i < count; i++) {
    const t = Math.pow(rnd(i * 2.7), 0.6)
    const r = 7 + t * 38
    const arm = i % arms
    const ang = arm * Math.PI + 2.4 * Math.log(1 + t * 6.0) + (rnd(i * 9.1) - 0.5) * (0.38 + t * 0.5)
    const rr = r * (1 - 0.04 * rnd(i * 4.3))
    pos[i * 3] = Math.cos(ang) * rr
    pos[i * 3 + 1] = (rnd(i * 6.1) - 0.5) * (1.0 + t * 2.4)
    pos[i * 3 + 2] = Math.sin(ang) * rr
    const core = Math.pow(Math.max(0, 1 - t * 2.2), 2.2)
    col[i * 3] = 0.62 + 0.38 * core + 0.06 * t
    col[i * 3 + 1] = 0.70 + 0.18 * core + 0.04 * t
    col[i * 3 + 2] = 1.0 - 0.26 * core
    siz[i] = 0.55 + rnd(i * 13.1) * 1.2 + core * 0.7
    sd[i] = rnd(i * 17.9)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1))
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
  const galaxy = new THREE.Points(g, galaxyStarMaterial())
  galaxy.frustumCulled = false
  skyRig.add(galaxy)

  // 外圈蓝白环
  const ringCount = 9000
  const rp = new Float32Array(ringCount * 3)
  const rc = new Float32Array(ringCount * 3)
  const rs = new Float32Array(ringCount)
  const rd = new Float32Array(ringCount)
  for (let i = 0; i < ringCount; i++) {
    const a = rnd(i * 3.1) * Math.PI * 2
    const r = 38 + rnd(i * 7.7) * 14
    rp[i * 3] = Math.cos(a) * r + (rnd(i * 2.3) - 0.5) * 4
    rp[i * 3 + 1] = (rnd(i * 5.1) - 0.5) * 3.5
    rp[i * 3 + 2] = Math.sin(a) * r + (rnd(i * 8.3) - 0.5) * 4
    rc[i * 3] = 0.6
    rc[i * 3 + 1] = 0.78
    rc[i * 3 + 2] = 1.0
    rs[i] = 0.5 + rnd(i * 11.7) * 0.9
    rd[i] = rnd(i * 19.3)
  }
  const rg = new THREE.BufferGeometry()
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3))
  rg.setAttribute('aColor', new THREE.BufferAttribute(rc, 3))
  rg.setAttribute('aSize', new THREE.BufferAttribute(rs, 1))
  rg.setAttribute('aSeed', new THREE.BufferAttribute(rd, 1))
  const ring = new THREE.Points(rg, galaxyStarMaterial())
  ring.frustumCulled = false
  skyRig.add(ring)

  // 星爆团
  for (let i = 0; i < 130; i++) {
    const t = Math.pow(rnd(i * 3.3), 0.58)
    const r = 9 + t * 36
    const arm = i % 2
    const ang = arm * Math.PI + 2.4 * Math.log(1 + t * 6.0) + (rnd(i * 8.7) - 0.5) * 0.34
    const rose = rnd(i * 1.7) > 0.3
    addCloudMesh(
      rose ? [1.0, 0.22, 0.32] : [0.42, 0.72, 1.0],
      rose ? [1.0, 0.62, 0.5] : [0.85, 0.95, 1.0],
      rnd(i * 5.7) * 10, 0.18 + rnd(i) * 0.14, 10 + rnd(i) * 16,
      Math.cos(ang) * r, (rnd(i * 5.9) - 0.5) * 2.2, Math.sin(ang) * r,
    )
  }

  // 尘埃带
  for (let i = 0; i < 34; i++) {
    const t = Math.pow(rnd(i * 2.9), 0.58)
    const r = 9 + t * 38
    const ang = (i % 2) * Math.PI + 2.4 * Math.log(1 + t * 6.0) - 0.32
    addCloudMesh([0.09, 0.05, 0.02], [0.26, 0.16, 0.07], rnd(i * 6.3) * 10, 0.34,
      13 + rnd(i) * 24, Math.cos(ang) * r, (rnd(i * 3.3) - 0.5) * 2.0, Math.sin(ang) * r, true)
  }

  // 核球：外圈金、内芯白
  addCloudMesh([1.0, 0.72, 0.35], [1.0, 0.9, 0.62], 3.3, 0.3, 40, 0, 0, 0)
  addCloudMesh([1.0, 0.92, 0.78], [1.0, 1.0, 0.96], 7.1, 0.34, 16, 0, 0, 0)

  starField(5000, 120, 460, 0.95)
}

function galaxyStarMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aSeed;
      uniform float uTime; uniform float uPixel;
      varying vec3 vC; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vC = aColor;
        vA = 0.26 + 0.12 * sin(uTime * 0.6 + aSeed * 45.0);
        gl_PointSize = aSize * uPixel * (420.0 / max(-mv.z, 1.0));
      }
    `,
    fragmentShader: `
      varying vec3 vC; varying float vA;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vC, smoothstep(0.5, 0.0, d) * vA);
      }
    `,
  })
}

/* ---------------- 神经云主题：中间主神经元，向四周发散出神经细胞 ---------------- */
const NEURO = {
  group: new THREE.Group(),
  cells: [],
  regions: [],
  somaMat: null,
  lineMat: null,
  hoverRegion: -1,
  hoverCell: -1,
  peekOwned: false,
}

const NEURO_HUES = [200, 280, 160, 30, 320, 240, 180, 60, 300, 120]

function neuroClear() {
  while (NEURO.group.children.length) {
    const c = NEURO.group.children.pop()
    if (c.geometry) c.geometry.dispose()
    if (c.material) c.material.dispose()
  }
  NEURO.cells.length = 0
  NEURO.regions.length = 0
  NEURO.hoverRegion = -1
  NEURO.hoverCell = -1
}

function fibDir(i, n) {
  const y = 1 - (i / Math.max(n - 1, 1)) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const phi = i * 2.399963
  return new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r)
}

/* 每个主分区一片区域；区域内在子分区里长神经细胞 */
function buildNeuronSky() {
  neuroClear()
  const tops = state.folders.filter((f) => !f.parent)
  const R = 46
  const centers = tops.map((f, i) => {
    const d = fibDir(i, tops.length)
    return new THREE.Vector3(d.x * R, d.y * R * 0.55, d.z * R)
  })

  const somaPos = []
  const somaCol = []
  const somaSize = []
  const somaDist = []
  const somaRegion = []
  const somaEmpty = []
  const somaSeed = []

  const linePos = []
  const lineT = []
  const lineDist = []
  const lineRegion = []
  const lineEmpty = []
  const lineCol = []

  const pushCol = (arr, c) => arr.push(c.r, c.g, c.b)

  const maxD = R + 16
  const memColFor = (hue, empty) => {
    const c = new THREE.Color().setHSL(hue / 360, empty ? 0.35 : 0.72, empty ? 0.42 : 0.62)
    return c
  }

  const addLine = (a, b, tA, tB, dist, region, empty, col) => {
    linePos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    lineT.push(tA, tB)
    lineDist.push(dist, dist)
    lineRegion.push(region, region)
    lineEmpty.push(empty, empty)
    pushCol(lineCol, col)
    pushCol(lineCol, col)
  }

  tops.forEach((top, ri) => {
    const hue = NEURO_HUES[ri % NEURO_HUES.length]
    const center = centers[ri]
    NEURO.regions.push({ k: top.k, name: top.name, center, hue, count: 0 })

    const list = state.memories.filter((m) => m.folder === top.k || m.parent === top.k)
    // 记忆不够就先长空细胞，等以后有新记忆再补进来（空细胞不进任何分区内容）
    const target = Math.max(list.length + 3, 11)
    const cells = []
    for (let i = 0; i < target; i++) {
      const mem = list[i] || null
      const dir = fibDir(i, target)
      const rad = 8 + rnd(ri * 13 + i * 7) * 11
      const pos = center.clone().add(new THREE.Vector3(dir.x * rad, dir.y * rad * 0.8, dir.z * rad))
      cells.push({ pos, mem })
    }

    const distOf = (p) => clamp(p.length() / maxD, 0, 1)

    cells.forEach((cell, i) => {
      const empty = cell.mem ? 0 : 1
      const col = memColFor(hue + (empty ? 0 : rnd(i * 3.1) * 24 - 12), !!empty)
      somaPos.push(cell.pos.x, cell.pos.y, cell.pos.z)
      pushCol(somaCol, col)
      somaSize.push(empty ? 5.5 : 8 + rnd(i * 5.7) * 4)
      somaDist.push(distOf(cell.pos))
      somaRegion.push(ri)
      somaEmpty.push(empty)
      somaSeed.push(rnd(i * 7.3))
      const rec = {
        region: ri, memId: cell.mem ? cell.mem.id : null, pos: cell.pos, hue, empty: !!empty,
        name: cell.mem ? cell.mem.text : '',
      }
      NEURO.cells.push(rec)
      if (cell.mem) NEURO.regions[ri].count++

      // 树突：每条细胞伸出 5 根弯曲的枝
      const branches = 5
      for (let b = 0; b < branches; b++) {
        const a = (b / branches) * Math.PI * 2 + rnd(i * 3 + b) * 0.9
        const tilt = 0.5 + rnd(i + b * 2.1) * 0.9
        let p = cell.pos.clone()
        const dirv = new THREE.Vector3(Math.cos(a), tilt * 0.55, Math.sin(a)).normalize()
        const segs = 6
        let tPrev = 0
        for (let s = 1; s <= segs; s++) {
          const step = (1.4 + rnd(i * 5 + b * 3 + s) * 1.7)
          const next = p.clone().add(dirv.clone().multiplyScalar(step).add(new THREE.Vector3(
            (rnd(i + b + s * 1.7) - 0.5) * 1.4,
            (rnd(i * 2 + b + s) - 0.5) * 1.4,
            (rnd(i + b * 2 + s * 2.3) - 0.5) * 1.4,
          )))
          const tNext = s / segs
          addLine(p, next, tPrev, tNext, distOf(cell.pos), ri, empty, col)
          p = next
          tPrev = tNext
        }
      }
    })

    // 区域内部突触：把细胞串成网
    for (let i = 0; i < NEURO.cells.length; i++) {
      const a = NEURO.cells[i]
      if (a.region !== ri) continue
      const next = NEURO.cells[(i + 2) % NEURO.cells.length]
      if (next && next.region === ri && next !== a) {
        const col = new THREE.Color().setHSL(hue / 360, 0.7, 0.6)
        addLine(a.pos, next.pos, 0, 1, distOf(a.pos), ri, 0, col)
      }
    }
  })

  // 主干：中央主神经元 → 每片区域
  const hub = new THREE.Vector3(0, 0, 0)
  somaPos.push(0, 0, 0)
  pushCol(somaCol, new THREE.Color(0.85, 0.95, 1.0))
  somaSize.push(30)
  somaDist.push(0)
  somaRegion.push(-1)
  somaEmpty.push(0)
  somaSeed.push(0.5)

  tops.forEach((top, ri) => {
    const col = new THREE.Color().setHSL(NEURO_HUES[ri % NEURO_HUES.length] / 360, 0.7, 0.66)
    addLine(hub, centers[ri], 0, 1, 0.02, ri, 0, col)
    const c = centers[ri]
    somaPos.push(c.x, c.y, c.z)
    pushCol(somaCol, col)
    somaSize.push(17)
    somaDist.push(clamp(c.length() / maxD, 0, 1))
    somaRegion.push(ri)
    somaEmpty.push(0)
    somaSeed.push(rnd(ri * 3.7))
  })

  // 区域之间也连上，整片云团不分开
  tops.forEach((top, ri) => {
    const a = centers[ri]
    for (let k = 1; k <= 2; k++) {
      const b = centers[(ri + k) % centers.length]
      if (!b || b === a) continue
      const col = new THREE.Color().setHSL(NEURO_HUES[ri % NEURO_HUES.length] / 360, 0.55, 0.55)
      addLine(a, b, 0, 1, clamp(a.length() / 60, 0, 1), ri, 0, col)
    }
  })

  const somaGeo = new THREE.BufferGeometry()
  somaGeo.setAttribute('position', new THREE.Float32BufferAttribute(somaPos, 3))
  somaGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(somaCol, 3))
  somaGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(somaSize, 1))
  somaGeo.setAttribute('aDist', new THREE.Float32BufferAttribute(somaDist, 1))
  somaGeo.setAttribute('aRegion', new THREE.Float32BufferAttribute(somaRegion, 1))
  somaGeo.setAttribute('aEmpty', new THREE.Float32BufferAttribute(somaEmpty, 1))
  somaGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(somaSeed, 1))

  NEURO.somaMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() }, uHover: { value: -1 } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aDist;
      attribute float aRegion; attribute float aEmpty; attribute float aSeed;
      uniform float uTime; uniform float uPixel; uniform float uHover;
      varying vec3 vC; varying float vA; varying float vG;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // 从中心向外扩散的波
        float w = fract(uTime * 0.18 - aDist * 1.25);
        float front = pow(1.0 - abs(w * 2.0 - 1.0), 9.0);
        float tw = 0.75 + 0.25 * sin(uTime * 1.3 + aSeed * 40.0);
        float on = (uHover < -0.5) ? 1.0 : (abs(aRegion - uHover) < 0.5 ? 1.0 : 0.16);
        float base = (aEmpty > 0.5) ? 0.32 : 0.8;
        vC = aColor;
        vA = (base * 0.6 * tw + front * 1.0) * on;
        vG = front * on;
        gl_PointSize = aSize * uPixel * (1.0 + front * 0.8) * (330.0 / max(-mv.z, 1.0));
      }
    `,
    fragmentShader: `
      varying vec3 vC; varying float vA; varying float vG;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vC * (1.0 + vG * 1.6), core * core * vA);
      }
    `,
  })
  const somas = new THREE.Points(somaGeo, NEURO.somaMat)
  somas.frustumCulled = false
  NEURO.group.add(somas)

  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3))
  lineGeo.setAttribute('aT', new THREE.Float32BufferAttribute(lineT, 1))
  lineGeo.setAttribute('aDist', new THREE.Float32BufferAttribute(lineDist, 1))
  lineGeo.setAttribute('aRegion', new THREE.Float32BufferAttribute(lineRegion, 1))
  lineGeo.setAttribute('aEmpty', new THREE.Float32BufferAttribute(lineEmpty, 1))
  lineGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(lineCol, 3))

  NEURO.lineMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uHover: { value: -1 } },
    vertexShader: `
      attribute float aT; attribute float aDist; attribute float aRegion;
      attribute float aEmpty; attribute vec3 aColor;
      uniform float uTime; uniform float uHover;
      varying vec3 vC; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float w = fract(uTime * 0.2 - aDist * 1.2 - aT * 0.12);
        float pulse = pow(1.0 - abs(w * 2.0 - 1.0), 7.0);
        float on = (uHover < -0.5) ? 1.0 : (abs(aRegion - uHover) < 0.5 ? 1.0 : 0.12);
        float base = (aEmpty > 0.5) ? 0.06 : 0.14;
        vC = aColor;
        vA = (base + pulse * 1.05) * on;
      }
    `,
    fragmentShader: `
      varying vec3 vC; varying float vA;
      void main() { gl_FragColor = vec4(vC, vA); }
    `,
  })
  const lines = new THREE.LineSegments(lineGeo, NEURO.lineMat)
  lines.frustumCulled = false
  NEURO.group.add(lines)

  if (!NEURO.group.parent) scene.add(NEURO.group)
  NEURO.built = true
}

function neuroSetHover(region, cell) {
  NEURO.hoverRegion = region
  NEURO.hoverCell = cell
  if (NEURO.somaMat) NEURO.somaMat.uniforms.uHover.value = region
  if (NEURO.lineMat) NEURO.lineMat.uniforms.uHover.value = region
}

function neuroPick(cx, cy) {
  if (!NEURO.built) return null
  let best = null
  for (let i = 0; i < NEURO.cells.length; i++) {
    const c = NEURO.cells[i]
    tmpV.copy(c.pos).project(camera)
    if (tmpV.z > 1) continue
    const sx = (tmpV.x * 0.5 + 0.5) * window.innerWidth
    const sy = (-tmpV.y * 0.5 + 0.5) * window.innerHeight
    const d = Math.hypot(sx - cx, sy - cy)
    if (d < 30 && (!best || d < best.d)) best = { d, cell: i, region: c.region }
  }
  if (best) return { kind: 'cell', cell: best.cell, region: best.region }
  // 没点到细胞就按最近区域算
  let near = null
  for (let i = 0; i < NEURO.regions.length; i++) {
    const r = NEURO.regions[i]
    tmpV.copy(r.center).project(camera)
    if (tmpV.z > 1) continue
    const sx = (tmpV.x * 0.5 + 0.5) * window.innerWidth
    const sy = (-tmpV.y * 0.5 + 0.5) * window.innerHeight
    const d = Math.hypot(sx - cx, sy - cy)
    if (d < 110 && (!near || d < near.d)) near = { d, region: i }
  }
  return near ? { kind: 'region', region: near.region } : null
}

/* 右侧预览卡 */
function neuroPeek(hit) {
  const card = $('peek')
  if (!card) return
  if (!hit) {
    card.classList.remove('show')
    return
  }
  const r = NEURO.regions[hit.region]
  if (!r) { card.classList.remove('show'); return }
  card.innerHTML = ''
  const t = document.createElement('div')
  t.className = 'pk-t'
  t.textContent = r.name
  card.appendChild(t)
  const meta = document.createElement('div')
  meta.className = 'pk-m'
  meta.textContent = `${r.count} 条记忆`
  card.appendChild(meta)
  if (hit.kind === 'cell' && hit.cell != null) {
    const c = NEURO.cells[hit.cell]
    if (c && c.memId) {
      const p = document.createElement('div')
      p.className = 'pk-p'
      p.textContent = c.name
      card.appendChild(p)
    }
  }
  card.classList.add('show')
}

function disposeTree(obj) {
  obj.traverse?.((o) => {
    // 只释放几何体；贴图（GLOW_TEX / dotTexture / 文字图集）是所有星点共享的，
    // 一释放，切一次主题之后星点就会变黑方块或消失 —— 这就是之前"错位/串场"的来源
    if (o.geometry) o.geometry.dispose()
    const mat = o.material
    if (!mat) return
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat.dispose()
  })
}

function clearSky() {
  cloudMeshes.length = 0
  if (skyRig) {
    scene.remove(skyRig)
    disposeTree(skyRig)
  }
  skyRig = new THREE.Group()
}

// 切主题时把不属于「当前主题 + 星辰」的对象全部扫掉，杜绝背景串场
function sweepScene() {
  const keep = new Set([camera])
  if (dust) keep.add(dust)
  for (const [, n] of mains) keep.add(n.group)
  for (const rec of webLines) keep.add(rec.line)
  if (NEURO && NEURO.group) keep.add(NEURO.group)
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const c = scene.children[i]
    if (keep.has(c)) continue
    scene.remove(c)
    disposeTree(c)
  }
}

function buildSky(themeName) {
  const theme = THEMES[themeName] || THEMES.nebula
  clearSky()
  sweepScene()
  if (theme.kind === 'neuron') buildNeuronSky()
  else if (theme.kind === 'galaxy') buildGalaxySky()
  else buildNebulaSky()
  if (!skyRig.parent) scene.add(skyRig)
  cam.pitch = theme.pitch
  cam.dist = theme.dist
  camCur.pitch = theme.pitch
  camCur.dist = theme.dist
  fit.dist = theme.dist
}

/* ---------------- 星系构建 ---------------- */
function clearScene() {
  for (const [, m] of mains) scene.remove(m.group)
  mains.clear()
  subs.clear()
  mems.clear()
  pickables.length = 0
  labelNodes.length = 0
  hotRanges = new Map()
  for (const rec of webLines) { scene.remove(rec.line); rec.line.material.dispose() }
  webLines.length = 0
}

function buildGalaxy() {
  clearScene()
  const tops = state.folders.filter((f) => !f.parent)
  const byFolder = new Map()
  for (const m of state.memories) {
    if (!byFolder.has(m.folder)) byFolder.set(m.folder, [])
    byFolder.get(m.folder).push(m)
  }
  const glow = radialTexture(2.0)
  const topCount = Math.max(tops.length, 1)

  tops.forEach((top, i) => {
    const arm = i % 2
    const t = topCount <= 1 ? 0.5 : i / (topCount - 1)
    const r = 11 + t * 19
    const ang = t * 2.6 + arm * Math.PI + 0.3
    const px = Math.cos(ang) * r
    const pz = Math.sin(ang) * r
    const py = (arm ? 1 : -1) * (1.1 + rnd(i * 5.3) * 1.6)

    const color = PALETTE[i % PALETTE.length]
    const group = new THREE.Group()
    group.position.set(px, py, pz)
    scene.add(group)

    // 云气
    for (let c = 0; c < 4; c++) {
      const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow,
        color: new THREE.Color(
          clamp(color[0] * (0.65 + rnd(c + i) * 0.5), 0, 1),
          clamp(color[1] * (0.65 + rnd(c + i + 3) * 0.5), 0, 1),
          clamp(color[2] * (0.65 + rnd(c + i + 6) * 0.5), 0, 1),
        ),
        transparent: true, opacity: 0.04 + rnd(c + i) * 0.045, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      const a = rnd(c * 5 + i) * Math.PI * 2
      const rr = 1.6 + rnd(c * 3 + i) * 4.2
      cloud.position.set(Math.cos(a) * rr, (rnd(c + i) - 0.5) * 1.6, Math.sin(a) * rr)
      cloud.scale.setScalar(5 + rnd(c + i) * 6)
      cloud.userData.base = cloud.material.opacity
      cloud.userData.isCloud = true
      group.add(cloud)
    }

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: new THREE.Color(color[0] * 0.8, color[1] * 0.8, color[2] * 0.95),
      transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    halo.scale.setScalar(7)
    halo.userData.base = 0.3
    group.add(halo)

    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: new THREE.Color(1, 1, 1),
      transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    core.scale.setScalar(1.9)
    core.userData.base = 0.95
    group.add(core)

    const hit = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: new THREE.Color(color[0], color[1], color[2]),
      transparent: true, opacity: 0.001, depthWrite: false,
    }))
    hit.scale.setScalar(5.2)
    group.add(hit)

    const label = textSprite(top.name, { size: 52, color: '#f2f7ff', opacity: 0.98 })
    label.position.set(0, 4.2, 0)
    group.add(label)

    const node = { k: top.k, name: top.name, group, color, pos: new THREE.Vector3(px, py, pz), subs: [], expand: 1, dim: 1, vel: 0, label, labelScale: label.scale.clone(), labelY: 4.2 }
    mains.set(top.k, node)
    labelNodes.push(node)
    pickables.push({ kind: 'main', k: top.k, object: hit, node })
    pickables.push({ kind: 'main', k: top.k, object: label, node })

    // 子分区
    const kids = state.folders.filter((f) => f.parent === top.k)
    kids.forEach((kid, j) => {
      const a = (j / Math.max(kids.length, 1)) * Math.PI * 2 + 0.6
      const rr = 4.4 + rnd(j * 3.3) * 1.2
      const sg = new THREE.Group()
      sg.position.set(Math.cos(a) * rr, (rnd(j * 2.1) - 0.5) * 1.8, Math.sin(a) * rr)
      group.add(sg)

      const sGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: new THREE.Color(0.7, 0.82, 1.0),
        transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      sGlow.scale.setScalar(3.2)
      sGlow.userData.base = 0.42
      sg.add(sGlow)

      const sHit = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: new THREE.Color(0.85, 0.92, 1), transparent: true, opacity: 0.001, depthWrite: false,
      }))
      sHit.scale.setScalar(2.4)
      sg.add(sHit)

      const sLabel = textSprite(kid.name, { size: 38, color: '#e2ecff', opacity: 0.95 })
      sLabel.position.set(0, 1.9, 0)
      sg.add(sLabel)

      const world = new THREE.Vector3()
      sg.getWorldPosition(world)
      const subNode = { k: kid.k, name: kid.name, parentK: top.k, group: sg, pos: world.clone(), expand: 1, dim: 1, vel: 0, label: sLabel, labelScale: sLabel.scale.clone(), labelY: 1.9 }
      subs.set(kid.k, subNode)
      labelNodes.push(subNode)
      node.subs.push(subNode)
      pickables.push({ kind: 'sub', k: kid.k, object: sHit, node: subNode })
      pickables.push({ kind: 'sub', k: kid.k, object: sLabel, node: subNode })
    })

    // 记忆点
    const dots = byFolder.get(top.k) || []
    if (!kids.length) placeDots(group, top.k, 2.2, 3.6, dots)
    kids.forEach((kid) => {
      const g = subs.get(kid.k).group
      placeDots(g, kid.k, 1.35, 2.3, byFolder.get(kid.k) || [])
    })

    // 更新子星辰世界坐标（等主组位置确定）
    node.subs.forEach((s) => s.group.getWorldPosition(s.pos))
  })

  // 视角：把整条星系框进来
  const maxR = 38
  fit.dist = clamp(118, 90, 260)
  cam.dist = fit.dist
  camCur.dist = fit.dist
  cam.tx = cam.ty = cam.tz = 0
  camCur.tx = camCur.ty = camCur.tz = 0

  buildWeb()
  applyDim()
  applyThemeGlyphs()
  if (state.theme === 'neuron') buildNeuronSky()
}

function placeDots(parent, folderK, rMin, rMax, list) {
  const n = Math.max(list.length, 1)
  list.forEach((m, idx) => {
    const seed = (m.id.charCodeAt(0) + m.id.charCodeAt(1) * 7 + idx * 13) % 997
    const a = (idx / n) * Math.PI * 2 + rnd(seed) * 1.4
    const r = rMin + rnd(seed + 3.1) * (rMax - rMin)
    const y = (rnd(seed + 7.3) - 0.5) * 1.2
    const fixed = m.state === 'fixed'
    const forgotten = m.state === 'forgotten'
    const fading = m.state === 'fading'
    const color = fixed
      ? new THREE.Color(1.0, 0.83, 0.5)
      : forgotten ? new THREE.Color(0.5, 0.5, 0.62)
        : fading ? new THREE.Color(0.62, 0.72, 0.92)
          : new THREE.Color(0.82, 0.92, 1.0)

    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture, color, transparent: true,
      opacity: fixed ? 0.95 : forgotten ? 0.4 : fading ? 0.68 : 0.92,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    const base = fixed ? 0.62 : forgotten ? 0.34 : fading ? 0.42 : 0.52
    sp.scale.setScalar(base)
    sp.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
    sp.userData.base = base
    sp.userData.baseOp = sp.material.opacity
    parent.add(sp)

    const world = new THREE.Vector3()
    sp.getWorldPosition(world)
    mems.set(m.id, { id: m.id, folder: m.folder, folderName: m.folderName, sprite: sp, pos: world.clone(), base, mem: m, dim: 1 })
    pickables.push({ kind: 'mem', id: m.id, object: sp, node: mems.get(m.id) })
  })
}

const dotTexture = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})()

/* ---------------- 丝线：常驻的乱网 ---------------- */
const webLines = []      // { line, from, to, ids }
const wa = new THREE.Vector3()
const wb = new THREE.Vector3()
const WEB_SEG = 24

const WEB_VERT = `
  uniform vec3 uFrom;
  uniform vec3 uTo;
  uniform float uLift;
  uniform float uHot;
  attribute float aT;
  varying float vT;
  varying float vHot;
  void main() {
    float t = aT;
    float u = 1.0 - t;
    vec3 mid = (uFrom + uTo) * 0.5 + vec3(0.0, uLift, 0.0);
    // 二次贝塞尔完全在显卡上算，端点在 uniform 里，天然跟得上星辰
    vec3 p = u * u * uFrom + 2.0 * u * t * mid + t * t * uTo;
    vT = t;
    vHot = uHot;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const WEB_FRAG = `
  uniform float uTime;
  uniform float uHot;
  varying float vT;
  varying float vHot;
  void main() {
    float flow = fract(vT * 1.5 - uTime * 0.4);
    float pulse = pow(1.0 - abs(flow * 2.0 - 1.0), 4.0);
    float base = 0.09 + vHot * 0.42;
    float a = base + pulse * vHot * 1.2;
    vec3 col = mix(vec3(0.6, 0.78, 1.0), vec3(1.0, 0.97, 0.9), vHot) * (1.0 + vHot * 0.7);
    gl_FragColor = vec4(col, a);
  }
`

let webGeo = null

function buildWeb() {
  for (const rec of webLines) {
    scene.remove(rec.line)
    rec.line.material.dispose()
  }
  webLines.length = 0
  hotRanges = new Map()

  if (webGeo) webGeo.dispose()
  webGeo = new THREE.BufferGeometry()
  const ts = new Float32Array(WEB_SEG + 1)
  for (let i = 0; i <= WEB_SEG; i++) ts[i] = i / WEB_SEG
  webGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((WEB_SEG + 1) * 3), 3))
  webGeo.setAttribute('aT', new THREE.BufferAttribute(ts, 1))

  const starRef = (folderK) => {
    if (subs.has(folderK)) return subs.get(folderK).group
    if (mains.has(folderK)) return mains.get(folderK).group
    return null
  }

  const addLine = (fromObj, toObj, lift, ids) => {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
      uniforms: {
        uFrom: { value: new THREE.Vector3() },
        uTo: { value: new THREE.Vector3() },
        uLift: { value: lift },
        uHot: { value: 0.2 },
        uTime: { value: 0 },
      },
      vertexShader: WEB_VERT,
      fragmentShader: WEB_FRAG,
    })
    const line = new THREE.Line(webGeo, mat)
    line.frustumCulled = false
    line.renderOrder = 2
    scene.add(line)
    const rec = { line, from: fromObj, to: toObj, ids, fromObj, toObj }
    webLines.push(rec)
    for (const id of ids) {
      if (!hotRanges.has(id)) hotRanges.set(id, [])
      hotRanges.get(id).push(rec)
    }
  }

  const byCluster = new Map()
  for (const [id, node] of mems) {
    const from = starRef(node.folder)
    if (!from) continue
    addLine(from, node.sprite, 0.9 + rnd(id.charCodeAt(0)) * 1.4, [id])
    if (!byCluster.has(node.folder)) byCluster.set(node.folder, [])
    byCluster.get(node.folder).push(node)
  }

  for (const [, list] of byCluster) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      const links = 1 + (i % 2)
      for (let k = 1; k <= links; k++) {
        const b = list[(i + k * 3 + 1) % list.length]
        if (!b || b.id === a.id) continue
        addLine(a.sprite, b.sprite, 1.6 + rnd(i + k) * 1.2, [a.id, b.id])
      }
    }
  }

  // 每条丝线归到它两端的星辰名下，标签要贴着这些线的最高点放
  const index = new Map()
  const push = (obj, rec) => {
    if (!obj) return
    if (!index.has(obj)) index.set(obj, [])
    if (!index.get(obj).includes(rec)) index.get(obj).push(rec)
  }
  for (const rec of webLines) {
    push(rec.fromObj, rec)
    push(rec.toObj, rec)
  }
  for (const [, n] of mains) n.starLines = index.get(n.group) || []
  for (const [, n] of subs) n.starLines = index.get(n.group) || []

  updateWeb()
}

/* 端点只更新 uniform，不在 CPU 上重算顶点 */
function updateWeb(time) {
  for (const rec of webLines) {
    if (!rec.from.parent || !rec.to.parent) continue
    rec.from.getWorldPosition(wa)
    rec.to.getWorldPosition(wb)
    const u = rec.line.material.uniforms
    u.uFrom.value.copy(wa)
    u.uTo.value.copy(wb)
    if (time != null) u.uTime.value = time
  }
}

function setHot(idsOrNull, level = 1.0) {
  for (const rec of webLines) rec.line.material.uniforms.uHot.value = 0.2
  if (!idsOrNull) return
  for (const id of idsOrNull) {
    for (const rec of hotRanges.get(id) || []) rec.line.material.uniforms.uHot.value = level
  }
}

/* 某个星辰下面（含子分区）的所有记忆 id，用来点亮丝线 */
function memIdsIn(k) {
  const ids = []
  for (const [id, node] of mems) {
    if (node.folder === k || (node.mem && node.mem.parent === k)) ids.push(id)
  }
  return ids.length ? ids : null
}

/* ---------------- 命中：按屏幕距离，小范围 ---------------- */
const tmpV = new THREE.Vector3()
function hitTest(clientX, clientY) {
  const w = window.innerWidth
  const h = window.innerHeight
  const cands = []
  const push = (pick, radius) => {
    pick.object.getWorldPosition(tmpV)
    tmpV.project(camera)
    if (tmpV.z > 1) return
    const sx = (tmpV.x * 0.5 + 0.5) * w
    const sy = (-tmpV.y * 0.5 + 0.5) * h
    const d = Math.hypot(sx - clientX, sy - clientY)
    if (d < radius) cands.push({ pick, d, weight: d / radius })
  }
  for (const pick of pickables) {
    if (pick.kind === 'main') push(pick, 26)
    else if (pick.kind === 'sub') push(pick, 18)
    else push(pick, 15)
  }
  if (!cands.length) {
    let best = null
    const nearest = (pick) => {
      pick.object.getWorldPosition(tmpV)
      tmpV.project(camera)
      if (tmpV.z > 1) return
      const sx = (tmpV.x * 0.5 + 0.5) * w
      const sy = (-tmpV.y * 0.5 + 0.5) * h
      const d = Math.hypot(sx - clientX, sy - clientY)
      const limit = pick.kind === 'mem' ? 30 : 34
      if (d < limit && (!best || d < best.d)) best = { pick, d }
    }
    for (const pick of pickables) nearest(pick)
    return best ? best.pick : null
  }
  cands.sort((a, b) => a.weight - b.weight)
  return cands[0].pick
}

/* ---------------- 交互 ---------------- */
function bindEvents() {
  canvas.addEventListener('pointerleave', () => {
    if (state.theme === 'neuron') { neuroSetHover(-1, -1); neuroPeek(null) }
  })

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    jump.active = false
    drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }
    moved = 0
    canvas.setPointerCapture(e.pointerId)
    canvas.classList.add('dragging')
  })

  canvas.addEventListener('pointermove', (e) => {
    if (state.theme === 'neuron' && !drag) {
      const hit = neuroPick(e.clientX, e.clientY)
      if (hit) {
        neuroSetHover(hit.region, hit.kind === 'cell' ? hit.cell : -1)
        neuroPeek(hit)
      } else {
        neuroSetHover(-1, -1)
        neuroPeek(null)
      }
      canvas.style.cursor = hit ? 'pointer' : 'grab'
    }
    if (drag) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      moved = Math.max(moved, Math.hypot(dx, dy))
      cam.yaw = drag.yaw - dx * 0.0052
      cam.pitch = clamp(drag.pitch + dy * 0.0042, -1.28, 1.28)
      return
    }
    const hit = hitTest(e.clientX, e.clientY)
    if (hit !== hovered) {
      hovered = hit
      canvas.style.cursor = hit ? 'pointer' : 'grab'
      if (hit && hit.kind === 'mem') setHot([hit.id], 0.9)
      else if (hit && (hit.kind === 'main' || hit.kind === 'sub')) setHot(memIdsIn(hit.k), 0.75)
      else if (!state.query) setHot(state.viewingMem ? [state.viewingMem.id] : null)
    }
  })

  window.addEventListener('pointerup', (e) => {
    canvas.classList.remove('dragging')
    if (!drag) return
    const wasDrag = moved > 5
    drag = null
    if (wasDrag) return
    if (state.theme === 'neuron') {
      const nh = neuroPick(e.clientX, e.clientY)
      if (nh) {
        if (nh.kind === 'cell' && nh.cell != null) {
          const c = NEURO.cells[nh.cell]
          if (c.memId) {
            const m = state.memories.find((x) => x.id === c.memId)
            if (m) { state.viewingMem = m; state.sel = null; setHot([m.id], 0.9); renderPanel() }
            return
          }
        }
        const r = NEURO.regions[nh.region]
        if (r) {
          cam.tx = r.center.x; cam.ty = r.center.y; cam.tz = r.center.z
          cam.dist = 34
        }
      }
      return
    }
    const hit = hitTest(e.clientX, e.clientY)
    if (hit) select(hit)
    else if (state.sel) clearSelection()
  })

  canvas.addEventListener('dblclick', (e) => {
    const hit = hitTest(e.clientX, e.clientY)
    if (!hit || hit.kind === 'mem') return
    const node = hit.kind === 'main' ? mains.get(hit.k) : subs.get(hit.k)
    if (!node) return
    node.expand = node.expand > 1.05 ? 1 : 1.9
    toast(node.expand > 1 ? '放大 ' + node.name : '收回 ' + node.name)
  })

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    jump.active = false
    const k = Math.exp(clamp(e.deltaY, -160, 160) * 0.0016)
    cam.dist = clamp(cam.dist * k, 5, 220)
  }, { passive: false })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.editing) { state.editing = false; renderPanel() }
      else if (state.viewingMem) { state.viewingMem = null; setHot(null); renderPanel() }
      else if (state.sel) clearSelection()
      else if (state.query) { $('search').value = ''; onSearch('') }
    }
  })
}

/* ---------------- 选择 / 聚焦 / 明暗 ---------------- */
function clearSelection() {
  state.sel = null
  state.editing = false
  state.viewingMem = null
  setHot(state.query ? state.matches : null)
  applyDim()
  renderPanel()
  $('panelTag').textContent = state.bandView ? '曲线' : '总览'
}

function select(pick) {
  state.editing = false
  state.viewingMem = null
  if (pick.kind === 'mem') {
    state.sel = { kind: 'mem', id: pick.id }
    state.viewingMem = mems.get(pick.id)?.mem || null
    setHot([pick.id], 0.95)
    $('panelTag').textContent = '记忆'
  } else {
    state.sel = { kind: pick.kind, k: pick.k }
    const node = pick.kind === 'main' ? mains.get(pick.k) : subs.get(pick.k)
    if (node) {
      // 永远以星辰本体的世界坐标为中心（点文字也飞到这里），不受标签偏移影响
      const worldPos = new THREE.Vector3()
      node.group.getWorldPosition(worldPos)
      node.pos.copy(worldPos)
      startJump(worldPos, pick.kind === 'main' ? 15 : 8.5)
    }
    setHot(state.query ? state.matches : memIdsIn(pick.k), 0.9)
    $('panelTag').textContent = pick.kind === 'main' ? '主星云' : '副星辰'
  }
  applyDim()
  renderPanel()
}

/* 神经云主题只看神经细胞：把原来的星点/文字藏起来 */
function applyThemeGlyphs() {
  const neuron = state.theme === 'neuron'
  for (const [, node] of mains) {
    node.group.visible = !neuron
    if (node.label) node.label.visible = !neuron
  }
  for (const [, node] of subs) {
    node.group.visible = !neuron
    if (node.label) node.label.visible = !neuron
  }
  for (const [, node] of mems) node.sprite.visible = !neuron
  for (const rec of webLines) rec.line.visible = !neuron
  if (!neuron) {
    const card = $('peek')
    if (card) card.classList.remove('show')
  }
}

function applyDim() {
  const sel = state.sel
  // 只有选中「星辰」才虚化别的星云；点开一条记忆不动星系明暗
  const starSel = sel && (sel.kind === 'main' || sel.kind === 'sub')
  const focusK = starSel ? (sel.kind === 'main' ? sel.k : (subs.get(sel.k)?.parentK || '')) : ''
  const focusMain = focusK ? (subs.has(focusK) ? subs.get(focusK).parentK : focusK) : ''

  for (const [k, node] of mains) {
    const related = !focusMain || k === focusMain
    node.dimTarget = related ? 1 : 0.16
  }
  for (const [k, node] of subs) {
    const related = !focusMain || node.parentK === focusMain
    const onPath = sel && sel.kind === 'sub' ? sel.k === k : related
    node.dimTarget = onPath ? 1 : (related ? 0.55 : 0.12)
  }
  const dimMem = !!focusMain || state.pinnedOnly || !!state.query
  const onlyMem = !!(sel && sel.kind === 'mem')
  for (const [id, node] of mems) {
    let target = 1
    if (state.pinnedOnly && !node.mem.pinned) target = 0.15
    else if (state.query) target = state.matches.has(id) ? 1 : 0.12
    else if (onlyMem) target = sel.id === id ? 1 : 0.55
    else if (focusMain && node.folder !== focusK && !(subs.has(node.folder) && subs.get(node.folder).parentK === focusMain)) target = 0.18
    node.dimTarget = dimMem || sel ? target : 1
  }
}

/* ---------------- 左面板 ---------------- */
function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function renderPanel() {
  const body = $('panelBody')
  body.innerHTML = ''
  if (state.bandView) return renderBand(body)
  if (state.viewingMem) return renderMemory(body)
  if (state.sel && state.sel.kind !== 'mem') return renderStar(body)
  if (state.pinnedOnly) return renderPinned(body)
  renderOverview(body)
  $('panelTag').textContent = '总览'
}

function renderOverview(body) {
  const total = state.memories.length
  const fixed = state.memories.filter((m) => m.pinned).length
  const aging = state.memories.filter((m) => !m.pinned && m.state !== 'fresh').length
  const st = el('div', 'stat')
  st.appendChild(el('span', null, '记忆 ')).appendChild(el('b', null, String(total)))
  st.appendChild(el('span', null, '固定 ')).appendChild(el('b', null, String(fixed)))
  st.appendChild(el('span', null, '在淡化 ')).appendChild(el('b', null, String(aging)))
  body.appendChild(st)
  body.appendChild(el('div', 'hr'))
  body.appendChild(el('div', 'label', '星辰 · 点一下跳过去'))

  const tops = state.folders.filter((f) => !f.parent)
  for (const top of tops) {
    const count = state.memories.filter((m) => m.folder === top.k || (m.parent === top.k)).length
    const item = el('div', 'star-item' + (state.sel && state.sel.k === top.k ? ' on' : ''))
    item.appendChild(el('span', 'dot'))
    item.appendChild(el('span', 'nm', top.name))
    item.appendChild(el('span', 'ct', String(count)))
    item.onclick = () => { const p = pickables.find((x) => x.kind === 'main' && x.k === top.k); if (p) select(p) }
    body.appendChild(item)

    for (const kid of state.folders.filter((f) => f.parent === top.k)) {
      const n = state.memories.filter((m) => m.folder === kid.k).length
      const sub = el('div', 'star-item sub' + (state.sel && state.sel.k === kid.k ? ' on' : ''))
      sub.appendChild(el('span', 'dot'))
      sub.appendChild(el('span', 'nm', kid.name))
      sub.appendChild(el('span', 'ct', String(n)))
      sub.onclick = () => { const p = pickables.find((x) => x.kind === 'sub' && x.k === kid.k); if (p) select(p) }
      body.appendChild(sub)
    }
  }
  const tip = el('div', 'muted', '拖拽转星系，滚轮缩放。左边的列表只跳星辰，记忆在选中星辰后看。')
  body.appendChild(tip)
}

function renderStar(body) {
  const sel = state.sel
  const node = sel.kind === 'main' ? mains.get(sel.k) : subs.get(sel.k)
  if (!node) { renderOverview(body); return }
  const back = el('button', 'btn ghost', '← 总览')
  back.onclick = () => { clearSelection() }
  body.appendChild(back)

  if (!state.editing) {
    const head = el('div', 'row')
    head.appendChild(el('span', 'label', sel.kind === 'main' ? '主星云' : '副星辰'))
    head.appendChild(el('span', 'pill', node.name || ''))
    body.appendChild(head)
    const btns = el('div', 'row end')
    const edit = el('button', 'btn', '修改名称')
    edit.onclick = () => { state.editing = true; renderPanel() }
    const del = el('button', 'btn', '删掉这颗星辰')
    del.onclick = async () => {
      const kids = state.folders.filter((f) => f.parent === node.k).length
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1'
        del.textContent = '再点确认删'
        del.classList.add('danger')
        setTimeout(() => {
          if (del.dataset.armed === '1') {
            del.dataset.armed = ''
            del.textContent = '删掉这颗星辰'
            del.classList.remove('danger')
          }
        }, 4000)
        toast(kids ? `再点一次就删，会连 ${kids} 个子星辰一起删` : '再点一次就删，记忆先进回收站')
        return
      }
      del.dataset.armed = ''
      del.textContent = '删掉这颗星辰'
      del.classList.remove('danger')
      const r = await fetch(`${API}/folder/rm`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: state.scope, k: node.k }),
      }).then((x) => x.json())
      if (r.ok) {
        toast(`删了 ${r.removed || 1} 个分区，转存 ${r.moved || 0} 条`, 'good')
        state.sel = null
        await loadData()
      } else toast(r.error || '没删掉', 'bad')
    }
    btns.appendChild(edit)
    btns.appendChild(del)
    body.appendChild(btns)
  } else {
    const input = el('input')
    input.type = 'text'
    input.value = node.name || ''
    body.appendChild(input)
    const btns = el('div', 'row end')
    const cancel = el('button', 'btn', '取消')
    cancel.onclick = () => { state.editing = false; renderPanel() }
    const save = el('button', 'btn primary', '保存')
    save.onclick = async () => {
      const name = input.value.trim()
      if (!name) return toast('名字不能空', 'bad')
      const r = await fetch(`${API}/folder`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: state.scope, k: node.k, name }),
      }).then((x) => x.json())
      if (r.ok) { toast('改名好了', 'good'); state.editing = false; await loadData() }
      else toast(r.error || '没改成', 'bad')
    }
    btns.appendChild(cancel); btns.appendChild(save)
    body.appendChild(btns)
  }

  body.appendChild(el('div', 'hr'))
  const list = state.memories.filter((m) => m.folder === node.k || (sel.kind === 'main' && m.parent === node.k))
  body.appendChild(el('div', 'label', `记忆 · ${list.length}`))
  if (!list.length) body.appendChild(el('div', 'muted', '这个星辰还是空的。'))
  for (const m of list) {
    const row = el('div', 'mem')
    row.appendChild(el('div', 't', m.text))
    const meta = el('div', 'm')
    meta.appendChild(el('span', 'pill' + (m.pinned ? ' fixed' : ''), m.pinned ? (m.autoFixed ? '默认固定' : '固定') : (m.days + ' 天')))
    if (!m.pinned) meta.appendChild(el('span', null, stateWord(m.state)))
    if (m.folder !== node.k) meta.appendChild(el('span', null, m.folderName))
    row.appendChild(meta)
    const acts = el('div', 'acts')
    const view = el('button', 'btn', '查看')
    view.onclick = () => { state.viewingMem = m; state.editing = false; setHot([m.id], 0.95); renderPanel(); $('panelTag').textContent = '记忆' }
    acts.appendChild(view)
    row.appendChild(acts)
    body.appendChild(row)
  }
}

function stateWord(s) {
  return s === 'forgotten' ? '即将遗忘' : s === 'fading' ? '7 天后淡化' : s === 'fixed' ? '固定' : '新鲜'
}

function renderMemory(body) {
  const m = state.viewingMem
  if (!m) { renderOverview(body); return }

  const back = el('button', 'btn ghost', '← 返回')
  back.onclick = () => { state.viewingMem = null; state.editing = false; setHot(state.query ? state.matches : null); renderPanel(); $('panelTag').textContent = state.sel && state.sel.kind !== 'mem' ? '星辰' : '总览' }
  body.appendChild(back)

  body.appendChild(el('div', 'label', `来自 · ${m.folderName}`))

  if (!state.editing) {
    const box = el('div', 'mem')
    box.appendChild(el('div', 't', m.text))
    body.appendChild(box)
    const meta = el('div', 'row')
    meta.appendChild(el('span', 'pill' + (m.pinned ? ' fixed' : ''), m.pinned ? (m.autoFixed ? '默认固定（不会被遗忘）' : '固定记忆') : `${m.days} 天 · ${stateWord(m.state)}`))
    body.appendChild(meta)

    const btns = el('div', 'row end')
    const edit = el('button', 'btn', '修改')
    edit.onclick = () => { state.editing = true; renderPanel() }
    const pin = el('button', 'btn' + (m.pinned ? ' on' : ''), m.pinned ? '取消固定' : '固定记忆')
    pin.onclick = async () => {
      const r = await fetch(`${API}/pin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: state.scope, folder: m.folder, id: m.id, pinned: !m.pinned }),
      }).then((x) => x.json())
      if (r.ok) { toast(m.pinned ? '放开了' : '固定住，不会忘', 'good'); const id = m.id; await loadData(); const nm = state.memories.find((x) => x.id === id); if (nm) state.viewingMem = nm; renderPanel() }
      else toast(r.error || '没成功', 'bad')
    }
    const del = el('button', 'btn', '删除')
    del.onclick = async () => {
      if (!confirm('删掉这条？会进回收站。')) return
      const r = await fetch(`${API}/del`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: state.scope, folder: m.folder, id: m.id }),
      }).then((x) => x.json())
      if (r.ok) { toast('删了', 'good'); state.viewingMem = null; await loadData() }
      else toast(r.error || '没删掉', 'bad')
    }
    btns.appendChild(del); btns.appendChild(pin); btns.appendChild(edit)
    body.appendChild(btns)
    return
  }

  const ta = el('textarea')
  ta.rows = 6
  ta.value = m.text
  body.appendChild(ta)
  const btns = el('div', 'row end')
  const cancel = el('button', 'btn', '取消')
  cancel.onclick = () => { state.editing = false; renderPanel() }
  const save = el('button', 'btn primary', '保存')
  save.onclick = async () => {
    const text = ta.value.trim()
    if (!text) return toast('写点啥', 'bad')
    const r = await fetch(`${API}/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: state.scope, folder: m.folder, id: m.id, text }),
    }).then((x) => x.json())
    if (r.ok) { toast('改好了', 'good'); state.editing = false; const id = m.id; await loadData(); const nm = state.memories.find((x) => x.id === id); if (nm) state.viewingMem = nm; renderPanel() }
    else toast(r.error || '没存上', 'bad')
  }
  btns.appendChild(cancel); btns.appendChild(save)
  body.appendChild(btns)
}

function renderPinned(body) {
  const list = state.memories.filter((m) => m.pinned)
  body.appendChild(el('div', 'label', `固定记忆 · ${list.length}（不会被遗忘）`))
  if (!list.length) body.appendChild(el('div', 'muted', '还没有固定记忆。'))
  for (const m of list) {
    const row = el('div', 'mem')
    row.appendChild(el('div', 't', m.text))
    const meta = el('div', 'm')
    meta.appendChild(el('span', 'pill fixed', m.autoFixed ? '默认固定' : '固定'))
    meta.appendChild(el('span', null, `${m.folderName} · ${m.days} 天`))
    row.appendChild(meta)
    row.onclick = () => { state.viewingMem = m; setHot([m.id], 0.95); renderPanel() }
    body.appendChild(row)
  }
}

function renderBand(body) {
  const { kind, folderName } = state.bandView
  const labels = { fresh: '还没到 7 天', fading: '7 天后淡化', forgotten: '30 天后遗忘' }
  const list = state.memories.filter((m) => !m.pinned && m.state === kind && (!folderName || m.folderName === folderName))
  const back = el('button', 'btn ghost', '← 总览')
  back.onclick = () => { state.bandView = null; renderPanel(); $('panelTag').textContent = '总览' }
  body.appendChild(back)
  body.appendChild(el('div', 'label', `${labels[kind] || ''} · ${folderName || '全部'} · ${list.length}`))
  if (!list.length) body.appendChild(el('div', 'muted', '这一档没有要处理的。'))
  for (const m of list) {
    const row = el('div', 'mem')
    row.appendChild(el('div', 't', m.text))
    row.appendChild(el('div', 'm', `${m.folderName} · ${m.days} 天`))
    const acts = el('div', 'acts')
    const pin = el('button', 'btn', '固定住')
    pin.onclick = async (ev) => {
      ev.stopPropagation()
      const r = await fetch(`${API}/pin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: state.scope, folder: m.folder, id: m.id, pinned: true }),
      }).then((x) => x.json())
      if (r.ok) { toast('固定住了', 'good'); state.bandView = { kind, folderName }; await loadData() }
      else toast(r.error || '没成功', 'bad')
    }
    acts.appendChild(pin)
    row.appendChild(acts)
    row.onclick = () => { state.viewingMem = m; state.bandView = null; setHot([m.id], 0.95); renderPanel() }
    body.appendChild(row)
  }
}

/* ---------------- 遗忘曲线 ---------------- */
function renderCurve() {
  const free = state.memories.filter((m) => !m.pinned)
  const fading = free.filter((m) => m.state === 'fading')
  const gone = free.filter((m) => m.state === 'forgotten')
  const soon = free.filter((m) => m.state === 'fresh' && m.days >= 3)
  $('curveCount').textContent = `淡化 ${fading.length} · 将忘 ${gone.length}`

  const path = $('curvePath')
  const len = path.getTotalLength()
  const marks = [
    { t: 0.02, text: '新生', color: '#9fd0ff' },
    { t: 0.55, text: '7 天', color: '#93a7cc' },
    { t: 1.0, text: '30 天', color: '#7a80a0' },
  ]
  const dots = $('curveDots'); dots.innerHTML = ''
  const labelsEl = $('curveLabels'); labelsEl.innerHTML = ''
  const VB_W = 330
  const VB_H = 104
  for (const mk of marks) {
    const p = path.getPointAtLength(len * mk.t)
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', 2.4); c.setAttribute('fill', mk.color)
    dots.appendChild(c)
    const tx = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    // 靠右端的标签往回收，避免被 viewBox 裁掉又贴不到点上
    const endMark = mk.t >= 0.95
    const x = endMark ? p.x - 6 : p.x + 7
    const y = clamp(p.y - (endMark ? 13 : 7), 12, VB_H - 4)
    tx.setAttribute('x', String(clamp(x, 4, VB_W - 4)))
    tx.setAttribute('y', String(y))
    tx.setAttribute('text-anchor', endMark ? 'end' : 'start')
    tx.setAttribute('fill', mk.color)
    tx.setAttribute('font-size', '9')
    tx.setAttribute('opacity', '0.9')
    tx.textContent = mk.text
    labelsEl.appendChild(tx)
  }

  const zones = $('curveZones')
  zones.innerHTML = ''
  const box = (title, list, kind, fallback) => {
    const z = el('div', 'zone')
    z.appendChild(el('div', 'zt', title))
    const zc = el('div', 'zc')
    const names = [...new Set(list.map((m) => m.folderName))]
    if (!names.length) {
      if (fallback && fallback.length) {
        const fnames = [...new Set(fallback.map((m) => m.folderName))]
        for (const name of fnames.slice(0, 4)) {
          const c = el('span', 'chip', name)
          c.style.opacity = '.55'
          c.title = '还没到这一档，快了'
          c.onclick = () => { state.bandView = { kind: 'fresh', folderName: name }; state.viewingMem = null; renderPanel(); $('panelTag').textContent = '曲线' }
          zc.appendChild(c)
        }
      } else {
        zc.appendChild(el('span', 'muted', '—'))
      }
    }
    for (const name of names.slice(0, 8)) {
      const c = el('span', 'chip', name)
      c.onclick = () => { state.bandView = { kind, folderName: name }; state.viewingMem = null; state.sel = null; renderPanel(); $('panelTag').textContent = '曲线' }
      zc.appendChild(c)
    }
    z.appendChild(zc)
    zones.appendChild(z)
  }
  box('7 天淡化', fading, 'fading', soon)
  box('30 天遗忘', gone, 'forgotten', null)
}

/* ---------------- 检索 ---------------- */
let searchTimer = 0
function onSearch(q) {
  state.query = q.trim().toLowerCase()
  state.matches = new Set()
  if (state.query) {
    for (const m of state.memories) {
      const hay = `${m.text || ''} ${m.folderName || ''} ${m.mainName || ''}`.toLowerCase()
      if (hay.includes(state.query)) state.matches.add(m.id)
    }
  }
  setHot(state.query ? state.matches : (state.viewingMem ? [state.viewingMem.id] : null), 0.95)
  applyDim()
  $('hitInfo').textContent = state.query ? `${state.matches.size} 条` : ''
  if (state.query && !state.matches.size) toast('没找到')
}

/* 相机跳转：cubic ease + 中途推拉 */
const jump = { active: false, t: 0, dur: 0.95, fromT: new THREE.Vector3(), toT: new THREE.Vector3(), fromD: 0, toD: 0 }

function startJump(target, dist) {
  jump.active = true
  jump.t = 0
  jump.fromT.set(camCur.tx, camCur.ty, camCur.tz)
  jump.toT.copy(target)
  jump.fromD = camCur.dist
  jump.toD = dist
  cam.tx = target.x
  cam.ty = target.y
  cam.tz = target.z
  cam.dist = dist
}

/* 星辰放大/收回：弹簧带一点回弹，标签反向缩放保持字号 */
function springScale(node, dt) {
  const k = 140
  const c = 16
  const x = node.group.scale.x
  const target = node.expand || 1
  node.vel = (node.vel || 0) + ((target - x) * k - (node.vel || 0) * c) * dt
  const nx = x + node.vel * dt
  node.group.scale.setScalar(nx)
}

/* ---------------- 循环 ---------------- */
function animate(now) {
  requestAnimationFrame(animate)
  const dt = Math.min((now - lastT) / 1000 || 0.016, 0.05)
  lastT = now
  const t = now / 1000

  const gearK = state.demo && state.demo.on ? state.demo.gear / 40 : 1
  if (!drag) cam.yaw += dt * 0.0045 * gearK
  camCur.yaw = damp(camCur.yaw, cam.yaw, 7, dt)
  camCur.pitch = damp(camCur.pitch, cam.pitch, 7, dt)

  if (jump.active) {
    jump.t += dt
    const k = Math.min(1, jump.t / jump.dur)
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2   // easeInOutCubic
    camCur.tx = jump.fromT.x + (jump.toT.x - jump.fromT.x) * e
    camCur.ty = jump.fromT.y + (jump.toT.y - jump.fromT.y) * e
    camCur.tz = jump.fromT.z + (jump.toT.z - jump.fromT.z) * e
    // 中途略微拉远再贴上去，像镜头推近
    const push = Math.sin(Math.PI * k)
    camCur.dist = (jump.fromD + (jump.toD - jump.fromD) * e) * (1 + push * 0.35)
    camera.fov = 48 - push * 4.5
    camera.updateProjectionMatrix()
    if (k >= 1) {
      jump.active = false
      camera.fov = 48
      camera.updateProjectionMatrix()
    }
  } else {
    camCur.dist = damp(camCur.dist, cam.dist, 8, dt)
    camCur.tx = damp(camCur.tx, cam.tx, 6, dt)
    camCur.ty = damp(camCur.ty, cam.ty, 6, dt)
    camCur.tz = damp(camCur.tz, cam.tz, 6, dt)
  }

  const cp = Math.cos(camCur.pitch)
  const breathe = 1 + Math.sin(t * 0.22) * 0.012
  camera.position.set(
    camCur.tx + Math.sin(camCur.yaw) * cp * camCur.dist * breathe,
    camCur.ty + Math.sin(camCur.pitch) * camCur.dist * breathe,
    camCur.tz + Math.cos(camCur.yaw) * cp * camCur.dist * breathe,
  )
  camera.lookAt(camCur.tx, camCur.ty, camCur.tz)

  for (const [, node] of mains) {
    springScale(node, dt)
    node.group.rotation.y += dt * 0.01
  }
  for (const [, node] of subs) springScale(node, dt)

  // 标签保持屏幕尺寸：越远越大、越近越小
  for (const node of labelNodes) {
    if (!node.label) continue
    const gs = Math.max(0.001, node.group.scale.x)
    node.group.getWorldPosition(tmpWorld)
    const d = tmpWorld.distanceTo(camera.position)
    const f = clamp(d / 110, 0.4, 2.6)
    node.label.scale.set((node.labelScale.x * f) / gs, (node.labelScale.y * f) / gs, 1)

    // 该星辰头顶最高的那条丝线（贝塞尔顶点在 uFrom/uTo 中点上方 uLift/2）
    let topY = tmpWorld.y
    for (const rec of node.starLines || []) {
      const u = rec.line.material.uniforms
      const ay = (u.uFrom.value.y + u.uTo.value.y) * 0.5 + u.uLift.value * 0.5
      if (ay > topY) topY = ay
    }
    const wantY = Math.max(topY + 1.5, tmpWorld.y + 1.5)
    node.label.position.y = (wantY - tmpWorld.y) / gs
  }
  for (const [, node] of mains) {
    applyNodeDim(node, dt)
  }
  for (const [, node] of subs) applyNodeDim(node, dt)
  for (const [, node] of mems) {
    node.sprite.getWorldPosition(tmpWorld)
    const df = clamp(tmpWorld.distanceTo(camera.position) / 110, 0.42, 1.05)
    const target = node.base * df * (node.dim ?? 1) * (hovered && hovered.id === node.id ? 1.7 : 1)
    node.sprite.scale.setScalar(damp(node.sprite.scale.x, target, 6, dt))
    node.sprite.material.opacity = damp(node.sprite.material.opacity, (node.sprite.userData.baseOp || 0.9) * (node.dim ?? 1), 6, dt)
  }
  if (state.theme === 'neuron') {
    if (NEURO.somaMat) NEURO.somaMat.uniforms.uTime.value = t
    if (NEURO.lineMat) NEURO.lineMat.uniforms.uTime.value = t
    NEURO.group.rotation.y += dt * 0.02
  }
  updateWeb(t)
  skyRig.rotation.y += dt * (state.theme === 'starburst' ? 0.01 : 0.0035) * (state.demo && state.demo.on ? state.demo.gear / 40 : 1)
  for (const m of cloudMeshes) m.quaternion.copy(camera.quaternion)
  for (const c of skyRig.children) if (c.isPoints) c.material.uniforms.uTime.value = t
  renderFrame()
}

function applyNodeDim(node, dt) {
  const want = node.dimTarget ?? 1
  node.dim = damp(node.dim ?? 1, want, 5, dt)
  node.group.traverse((o) => {
    if (!o.material || !o.material.opacity) return
    if (o.userData.base == null) return
    o.material.opacity = o.userData.base * node.dim
  })
}

/* ---------------- 数据 ---------------- */
async function loadScopes() {
  try {
    const r = await fetch(`${API}/scopes`, { cache: 'no-store' }).then((x) => x.json())
    state.scopes = r.scopes || []
  } catch { state.scopes = [{ id: 'global', label: '全局' }] }
  const sel = $('scope')
  sel.innerHTML = ''
  for (const s of state.scopes) {
    const o = document.createElement('option')
    o.value = s.id
    o.textContent = s.cwd ? `${s.label} · ${s.cwd}` : s.label
    sel.appendChild(o)
  }
  sel.value = state.scope
  const wsDel = $('wsDel')
  if (wsDel) wsDel.style.display = state.scope === 'global' ? 'none' : ''
}

async function loadData() {
  const r = await fetch(`${API}/data?scope=${encodeURIComponent(state.scope)}`, { cache: 'no-store' }).then((x) => x.json())
  state.folders = r.folders || []
  state.memories = r.memories || []
  buildGalaxy()
  if (state.viewingMem) {
    state.viewingMem = state.memories.find((m) => m.id === state.viewingMem.id) || null
  }
  renderCurve()
  renderPanel()
}

/* ---------------- 启动 ---------------- */
async function boot() {
  try {
    initRenderer()
    bindEvents()
    const themeBtns = Array.from(document.querySelectorAll('#themes .tbtn'))
    const syncThemeBtns = () => themeBtns.forEach((b) => b.classList.toggle('on', b.dataset.theme === state.theme))
    syncThemeBtns()
    for (const b of themeBtns) {
      b.addEventListener('click', () => {
        if (b.dataset.theme === state.theme) return
        state.theme = b.dataset.theme
        try { localStorage.setItem('memory-sky-theme', state.theme) } catch {}
        buildSky(state.theme)
        syncThemeBtns()
        applyDim()
        applyThemeGlyphs()
      })
    }
    const demoEl = $('demo')
    const demoToggle = $('demoToggle')
    const demoSpeed = $('demoSpeed')
    const demoSpeedText = $('demoSpeedText')
    const demoClean = $('demoClean')
    const syncDemo = () => {
      if (!demoEl) return
      demoEl.classList.toggle('on', state.demo.on)
      demoToggle.classList.toggle('on', state.demo.on)
      demoSpeedText.textContent = String(state.demo.gear)
      demoClean.checked = state.demo.clean
      document.body.classList.toggle('demo-clean', state.demo.clean)
    }
    if (demoEl) {
      const params = new URLSearchParams(location.search)
      if (params.get('demo')) state.demo.on = true
      if (params.get('gear')) state.demo.gear = clamp(Number(params.get('gear')) || 40, 1, 100)
      if (params.get('clean')) state.demo.clean = true
      demoSpeed.value = String(state.demo.gear)
      demoToggle.addEventListener('click', () => { state.demo.on = !state.demo.on; syncDemo() })
      demoSpeed.addEventListener('input', () => {
        state.demo.gear = clamp(Number(demoSpeed.value) || 40, 1, 100)
        syncDemo()
      })
      demoClean.addEventListener('change', () => { state.demo.clean = demoClean.checked; syncDemo() })
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.demo.clean) {
          state.demo.clean = false
          demoClean.checked = false
          syncDemo()
        }
      })
      syncDemo()
    }

    // AI 分类：先确认（会烧 token），再把任务挂到宿主，下一轮对话自动执行
    const askEl = $('ask')
    const askNote = $('askNote')
    const aiBtn = $('aiClassify')
    const apiCall = async (path, body) => {
      try {
        const res = await fetch('/api/memory-sky' + path, body
          ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {})
        return await res.json()
      } catch (e) {
        return { ok: false, error: '连不上宿主（可能需要重启 DeepSeek Harness）' }
      }
    }
    const refreshClassifyState = async () => {
      const r = await apiCall('/classify')
      if (r && r.ok && r.pending && askNote) {
        askNote.textContent = '已有一个待处理的分类任务：' + new Date(r.at).toLocaleString('zh-CN')
      } else if (askNote) {
        askNote.textContent = ''
      }
      if (aiBtn) aiBtn.classList.toggle('on', !!(r && r.ok && r.pending))
    }
    if (aiBtn) {
      aiBtn.addEventListener('click', () => {
        if (askEl) askEl.classList.add('show')
        refreshClassifyState()
      })
    }
    const askNo = $('askNo')
    if (askNo) askNo.addEventListener('click', () => askEl.classList.remove('show'))
    const askYes = $('askYes')
    if (askYes) {
      askYes.addEventListener('click', async () => {
        askEl.classList.remove('show')
        const r = await apiCall('/classify', {})
        if (r && r.ok) {
          toast('已排入队列：下一次对话时我会逐条重归类（会消耗 token）', 'good')
          refreshClassifyState()
        } else {
          toast((r && r.error) || '提交失败', 'bad')
        }
      })
    }
    if (askEl) {
      askEl.addEventListener('click', (e) => { if (e.target === askEl) askEl.classList.remove('show') })
    }

    $('scope').addEventListener('change', async (e) => {
      state.scope = e.target.value
      state.sel = null; state.viewingMem = null; state.bandView = null
      await loadData()
      const wsDel = $('wsDel')
      if (wsDel) wsDel.style.display = state.scope === 'global' ? 'none' : ''
    })
    const wsDelBtn = $('wsDel')
    if (wsDelBtn) {
      wsDelBtn.addEventListener('click', async () => {
        if (state.scope === 'global') return
        const one = state.scopes.find((s) => s.id === state.scope)
        if (!confirm(`删掉工作区「${one ? one.label : state.scope}」的整份记忆？\n会移到 ws/.deleted，不是真销毁。`)) return
        const r = await fetch(`${API}/scope/rm`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: state.scope }),
        }).then((x) => x.json())
        if (r.ok) {
          toast('删了，挪到 ws/.deleted', 'good')
          state.scope = 'global'
          state.sel = null
          await loadScopes()
          await loadData()
        } else toast(r.error || '没删掉', 'bad')
      })
    }
    $('search').addEventListener('input', (e) => {
      clearTimeout(searchTimer)
      const v = e.target.value
      searchTimer = setTimeout(() => onSearch(v), 130)
    })
    $('pinnedBtn').addEventListener('click', () => {
      state.pinnedOnly = !state.pinnedOnly
      $('pinnedBtn').classList.toggle('on', state.pinnedOnly)
      state.sel = null; state.viewingMem = null; state.bandView = null
      applyDim(); renderPanel()
      $('panelTag').textContent = state.pinnedOnly ? '固定记忆' : '总览'
    })
    $('resetBtn').addEventListener('click', () => {
      cam.tx = cam.ty = cam.tz = 0
      cam.dist = fit.dist
      cam.yaw = 0.62; cam.pitch = 0.5
      state.sel = null; state.viewingMem = null; state.bandView = null; state.editing = false
      applyDim(); renderPanel()
    })
    $('curveHead').addEventListener('click', () => $('curve').classList.toggle('collapsed'))

    await loadScopes()
    await loadData()
    requestAnimationFrame(animate)

    const params = new URLSearchParams(location.search)
    const q0 = params.get('q')
    if (q0) { $('search').value = q0; onSearch(q0) }
    const focus = params.get('focus')
    if (focus) {
      const node = mems.get(focus)
      if (node) { select({ kind: 'mem', id: focus }) }
    }
    const star = params.get('star')
    if (star) {
      const pick = pickables.find((x) => (x.kind === 'main' || x.kind === 'sub') && x.k === star)
      if (pick) select(pick)
    }
    // 调试用：?expand=K 直接把某个星辰放到放大状态
    const expand = params.get('expand')
    if (expand) {
      const node = mains.get(expand) || subs.get(expand)
      if (node) node.expand = 1.9
    }
  } catch (e) {
    $('fallback').style.display = 'flex'
    console.error(e)
  }
}

boot()
