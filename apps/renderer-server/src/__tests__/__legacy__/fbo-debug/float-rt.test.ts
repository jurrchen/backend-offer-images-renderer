/**
 * FloatType Render Target Test for headless-gl
 *
 * Tests whether headless-gl supports rendering TO FloatType textures
 * (as FBO color attachments). OES_texture_float is available in headless-gl,
 * but EXT_color_buffer_float is not explicitly exposed. However, ANGLE-based
 * implementations often allow float FBOs implicitly.
 *
 * Run:
 *   cd packages/renderer-server
 *   npx vitest run src/__tests__/fbo-debug/float-rt-test.ts
 */

import { describe, it, expect, afterAll } from 'vitest'
import createGL from 'gl'
import { createCanvas } from 'canvas'
import {
  WebGLRenderer,
  WebGLRenderTarget,
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  RGBAFormat,
  FloatType,
  UnsignedByteType,
  LinearFilter,
} from 'three'

// ── Singleton GL context ────────────────────────────────────────────────

const SIZE = 64 // Small size is fine for this test

let _renderer: WebGLRenderer | null = null
let _rawGL: any = null

function getRenderer(): { renderer: WebGLRenderer; rawGL: any } {
  if (_renderer && _rawGL) return { renderer: _renderer, rawGL: _rawGL }

  const canvas = createCanvas(SIZE, SIZE) as any
  const rawGL = createGL(SIZE, SIZE, {
    alpha: true,
    depth: true,
    stencil: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  })

  if (!rawGL) throw new Error('Failed to create headless-gl context')

  const originalGetContext = canvas.getContext.bind(canvas)
  canvas.getContext = function (contextType: string, _options?: any) {
    if (contextType === 'webgl' || contextType === 'webgl2') return rawGL
    return originalGetContext(contextType, _options)
  }
  canvas.addEventListener = () => {}
  canvas.removeEventListener = () => {}
  canvas.style = {}
  Object.defineProperty(canvas, 'clientWidth', { get: () => SIZE })
  Object.defineProperty(canvas, 'clientHeight', { get: () => SIZE })

  const renderer = new WebGLRenderer({
    canvas,
    context: rawGL as any,
    alpha: true,
    depth: true,
    stencil: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.setSize(SIZE, SIZE)
  renderer.setPixelRatio(1)

  _renderer = renderer
  _rawGL = rawGL
  return { renderer, rawGL }
}

function cleanup(): void {
  if (_renderer) {
    try { _renderer.dispose() } catch { /* ignore */ }
    _renderer = null
  }
  if (_rawGL) {
    try { _rawGL.getExtension('STACKGL_destroy_context')?.destroy() } catch { /* ignore */ }
    _rawGL = null
  }
}

// ── Test shaders ────────────────────────────────────────────────────────

/** Renders a horizontal gradient: R goes from 0.0 (left) to 1.0 (right) */
const gradientFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(vUv.x, vUv.y, 0.5, 1.0);
  }
`

/** Renders values > 1.0 — only preserved in float RTs */
const superWhiteFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  void main() {
    // R=2.0 at right edge, G=1.5 across the board, B=-0.5
    gl_FragColor = vec4(vUv.x * 2.0, 1.5, -0.5, 1.0);
  }
`

const basicVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Reads a texture and outputs it */
const readTexFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
  }
`

// ── Helpers ─────────────────────────────────────────────────────────────

function renderFullscreenQuad(
  renderer: WebGLRenderer,
  rt: WebGLRenderTarget,
  fragmentShader: string,
  uniforms: Record<string, { value: any }> = {},
): void {
  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const material = new ShaderMaterial({
    vertexShader: basicVert,
    fragmentShader,
    uniforms,
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  scene.add(mesh)

  renderer.setRenderTarget(rt)
  renderer.setClearColor(0x000000, 0)
  renderer.clear(true, true, true)
  renderer.render(scene, camera)

  scene.remove(mesh)
  material.dispose()
}

function readFloatPixels(
  renderer: WebGLRenderer,
  rt: WebGLRenderTarget,
): Float32Array {
  const gl = renderer.getContext() as WebGLRenderingContext
  const w = rt.width
  const h = rt.height
  renderer.setRenderTarget(rt)
  const floats = new Float32Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, floats)
  return floats
}

function readUint8Pixels(
  renderer: WebGLRenderer,
  rt: WebGLRenderTarget,
): Uint8Array {
  const pixels = new Uint8Array(rt.width * rt.height * 4)
  renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, pixels)
  return pixels
}

function checkFramebufferStatus(rawGL: any): number {
  return rawGL.checkFramebufferStatus(rawGL.FRAMEBUFFER)
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('FloatType Render Targets in headless-gl', () => {
  afterAll(() => cleanup())

  it('should report OES_texture_float extension available', () => {
    const { rawGL } = getRenderer()
    const ext = rawGL.getExtension('OES_texture_float')
    console.log(`OES_texture_float: ${ext ? 'YES' : 'NO'}`)
    expect(ext).not.toBeNull()
  })

  it('should report OES_texture_float_linear extension available', () => {
    const { rawGL } = getRenderer()
    const ext = rawGL.getExtension('OES_texture_float_linear')
    console.log(`OES_texture_float_linear: ${ext ? 'YES' : 'NO'}`)
    expect(ext).not.toBeNull()
  })

  it('should create a FloatType WebGLRenderTarget without error', () => {
    const { renderer, rawGL } = getRenderer()

    // Ensure extension is activated
    rawGL.getExtension('OES_texture_float')

    const rt = new WebGLRenderTarget(SIZE, SIZE, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: FloatType,
    })

    // Render something to force FBO creation
    renderFullscreenQuad(renderer, rt, gradientFrag)

    // Check framebuffer status
    const status = checkFramebufferStatus(rawGL)
    console.log(`Framebuffer status after FloatType RT: 0x${status.toString(16)} (COMPLETE=0x${rawGL.FRAMEBUFFER_COMPLETE.toString(16)})`)

    const isComplete = status === rawGL.FRAMEBUFFER_COMPLETE
    console.log(`FloatType FBO is ${isComplete ? 'COMPLETE' : 'NOT COMPLETE'}`)

    rt.dispose()
    expect(isComplete).toBe(true)
  })

  it('should render a gradient to FloatType RT and read back correct values', () => {
    const { renderer, rawGL } = getRenderer()
    rawGL.getExtension('OES_texture_float')

    const rt = new WebGLRenderTarget(SIZE, SIZE, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: FloatType,
    })

    renderFullscreenQuad(renderer, rt, gradientFrag)

    const floats = readFloatPixels(renderer, rt)

    // Sample some pixels across the gradient
    // Row 0 (bottom), center X
    const centerX = Math.floor(SIZE / 2)
    const centerY = Math.floor(SIZE / 2)
    const idx = (centerY * SIZE + centerX) * 4

    const r = floats[idx]
    const g = floats[idx + 1]
    const b = floats[idx + 2]
    const a = floats[idx + 3]

    console.log(`Center pixel (${centerX},${centerY}): R=${r.toFixed(4)}, G=${g.toFixed(4)}, B=${b.toFixed(4)}, A=${a.toFixed(4)}`)

    // R should be ~0.5 at center (horizontal gradient)
    // G should be ~0.5 at center (vertical gradient)
    // B should be 0.5 (constant)
    // A should be 1.0
    expect(r).toBeCloseTo(0.5, 1)
    expect(g).toBeCloseTo(0.5, 1)
    expect(b).toBeCloseTo(0.5, 1)
    expect(a).toBeCloseTo(1.0, 1)

    // Check that we have non-zero pixels (not all black)
    let nonZero = 0
    for (let i = 0; i < floats.length; i += 4) {
      if (floats[i] > 0.01 || floats[i + 1] > 0.01 || floats[i + 2] > 0.01) nonZero++
    }
    console.log(`Non-zero pixels: ${nonZero}/${SIZE * SIZE}`)
    expect(nonZero).toBeGreaterThan(SIZE * SIZE * 0.9)

    rt.dispose()
  })

  it('should preserve values > 1.0 in FloatType RT (not clamped)', () => {
    const { renderer, rawGL } = getRenderer()
    rawGL.getExtension('OES_texture_float')

    const rt = new WebGLRenderTarget(SIZE, SIZE, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: FloatType,
    })

    renderFullscreenQuad(renderer, rt, superWhiteFrag)

    const floats = readFloatPixels(renderer, rt)

    // Check right edge: R should be ~2.0 (not clamped to 1.0)
    const rightEdgeIdx = (Math.floor(SIZE / 2) * SIZE + (SIZE - 1)) * 4
    const r = floats[rightEdgeIdx]
    const g = floats[rightEdgeIdx + 1]
    const b = floats[rightEdgeIdx + 2]

    console.log(`Right-edge pixel: R=${r.toFixed(4)}, G=${g.toFixed(4)}, B=${b.toFixed(4)}`)
    console.log(`R > 1.0? ${r > 1.0} (expected: true if FloatType is working)`)
    console.log(`G > 1.0? ${g > 1.0} (expected: true — should be 1.5)`)
    console.log(`B < 0.0? ${b < 0.0} (expected: true — should be -0.5)`)

    // If FloatType works, R at right edge ≈ 2.0, G ≈ 1.5, B ≈ -0.5
    // If clamped to UnsignedByte behavior, R ≤ 1.0
    const floatWorksR = r > 1.5
    const floatWorksG = g > 1.2
    const floatWorksB = b < -0.2

    console.log(`\nFloatType RT verdict: ${floatWorksR && floatWorksG && floatWorksB ? 'WORKS — values not clamped!' : 'DOES NOT WORK — values are clamped'}`)

    rt.dispose()

    expect(floatWorksR).toBe(true)
    expect(floatWorksG).toBe(true)
    expect(floatWorksB).toBe(true)
  })

  it('should correctly chain two FloatType RTs (render to A, sample A in B)', () => {
    const { renderer, rawGL } = getRenderer()
    rawGL.getExtension('OES_texture_float')

    // RT A: render super-white values
    const rtA = new WebGLRenderTarget(SIZE, SIZE, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: FloatType,
    })

    // RT B: read from RT A's texture
    const rtB = new WebGLRenderTarget(SIZE, SIZE, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: FloatType,
    })

    // Step 1: Render super-white to RT A
    renderFullscreenQuad(renderer, rtA, superWhiteFrag)

    // Step 2: Read RT A's texture in RT B (passthrough)
    renderFullscreenQuad(renderer, rtB, readTexFrag, {
      tDiffuse: { value: rtA.texture },
    })

    // Read back from RT B
    const floats = readFloatPixels(renderer, rtB)

    const rightEdgeIdx = (Math.floor(SIZE / 2) * SIZE + (SIZE - 1)) * 4
    const r = floats[rightEdgeIdx]
    const g = floats[rightEdgeIdx + 1]
    const b = floats[rightEdgeIdx + 2]

    console.log(`Chained RT B right-edge: R=${r.toFixed(4)}, G=${g.toFixed(4)}, B=${b.toFixed(4)}`)
    console.log(`Values preserved through chain? R>${1.5}: ${r > 1.5}, G>${1.2}: ${g > 1.2}, B<${-0.2}: ${b < -0.2}`)

    rtA.dispose()
    rtB.dispose()

    // Values should be preserved through the chain
    expect(r).toBeGreaterThan(1.5)
    expect(g).toBeGreaterThan(1.2)
    expect(b).toBeLessThan(-0.2)
  })

  it('should read FloatType RT as Uint8 via readRenderTargetPixels (clamped to [0,255])', () => {
    const { renderer, rawGL } = getRenderer()
    rawGL.getExtension('OES_texture_float')

    const rt = new WebGLRenderTarget(SIZE, SIZE, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: FloatType,
    })

    renderFullscreenQuad(renderer, rt, gradientFrag)

    // Three.js readRenderTargetPixels returns Uint8 for UnsignedByte
    // For FloatType, we need to read as float and convert
    const floats = readFloatPixels(renderer, rt)
    const uint8 = new Uint8Array(floats.length)
    for (let i = 0; i < floats.length; i++) {
      uint8[i] = Math.max(0, Math.min(255, Math.round(floats[i] * 255)))
    }

    const centerIdx = (Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2)) * 4
    console.log(`Uint8 center pixel: R=${uint8[centerIdx]}, G=${uint8[centerIdx + 1]}, B=${uint8[centerIdx + 2]}, A=${uint8[centerIdx + 3]}`)

    // R and G should be ~128 at center, B=128, A=255
    expect(uint8[centerIdx]).toBeGreaterThan(100)
    expect(uint8[centerIdx]).toBeLessThan(155)
    expect(uint8[centerIdx + 3]).toBe(255)

    rt.dispose()
  })
})
