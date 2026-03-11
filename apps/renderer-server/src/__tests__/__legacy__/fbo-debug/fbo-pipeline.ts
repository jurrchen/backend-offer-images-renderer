/**
 * FBO Pipeline — 1:1 replica of ProductRendererV2.drawBuffer embroidery pipeline
 *
 * Matches the exact rendering flow including:
 * - Buffer RT with MSAA (samples:2 in browser, ignored in headless-gl WebGL1)
 * - EffectComposer ping-pong behavior for Sobel+Blur
 * - Proper render target filters matching ProductRendererV2.setTextures()
 *
 * Two modes via useDataTextureBetweenPasses:
 * - false = "composer" path: EffectComposer ping-pong (what browser does)
 *   NOTE: Due to EffectComposer's ping-pong ordering, SobelPass reads from an
 *   empty readBuffer (not from the RenderPass output). This is a known quirk of
 *   ProductRendererV2 — the processedLayer is effectively neutral on first render.
 *
 * - true = "patched" path: Manual fullscreen-quad Sobel+Blur (what HeadlessRenderer does)
 *   Reads directly from buffer texture, applies DataTexture workaround.
 */

import {
  WebGLRenderer,
  WebGLRenderTarget,
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Uniform,
  Vector2,
  DataTexture,
  RGBAFormat,
  UnsignedByteType,
  FloatType,
  LinearFilter,
  NearestFilter,
  ClampToEdgeWrapping,
  Texture,
  Color,
  CustomBlending,
  AddEquation,
  DstAlphaFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  OneFactor,
  GLSL1,
} from 'three'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── Shader loading ──────────────────────────────────────────────────────

const __dirname_local = dirname(fileURLToPath(import.meta.url))
const SHADER_DIR = join(__dirname_local, '../../../../../product-renderer/src/shaders')

function loadShader(filename: string): string {
  return readFileSync(join(SHADER_DIR, filename), 'utf-8')
}

const modelVertexShader = loadShader('modelVertexShader.vert.glsl')
const basicVertexShader = loadShader('basicVertexShader.vert.glsl')
const embroideryPatternFragmentShader = loadShader('embroideryPatternFragmentShader.frag.glsl')
const fxSobelFragmentShader = loadShader('fxSobelFragmentShader.frag.glsl')
const fxBlurFragmentShader = loadShader('fxBlurFragmentShader.frag.glsl')
const embroideryShaderBlendFrag = loadShader('embroideryShaderBlend.frag.glsl')
const embroideryShaderBaseFrag = loadShader('embroideryShaderBase.frag.glsl')

// ── Types ───────────────────────────────────────────────────────────────

export interface PassResult {
  name: string
  pixels: Uint8Array
  width: number
  height: number
  stats: {
    minR: number; maxR: number
    minG: number; maxG: number
    minB: number; maxB: number
    minA: number; maxA: number
    nonZeroPixels: number
    totalPixels: number
  }
}

export interface PipelineResult {
  passes: PassResult[]
}

export interface PipelineOptions {
  /** Size for buffer, embroidery, and final RTs. Default: 1024 */
  mainSize?: number
  /** Size for EffectComposer / processing RTs. Default: 512 */
  processingSize?: number
  /** MSAA samples for buffer RT (ignored by WebGL1/headless-gl). Default: 0 */
  bufferSamples?: number
  /**
   * Use combined Sobel+Blur shader that computes Sobel inline at each blur tap.
   * This keeps full float precision (avoids UnsignedByte clamping between passes).
   * Use this for headless-gl which can't use HalfFloat render targets.
   * Default: false
   */
  useCombinedSobelBlur?: boolean
  /**
   * Use FloatType (32-bit) render targets for the Sobel→Blur pipeline.
   * headless-gl supports OES_texture_float and can render to FloatType FBOs,
   * which preserves values outside [0,1] (like HalfFloat in the browser).
   * This allows using the standard two-pass pipeline without precision loss.
   * Default: false
   */
  useFloatRenderTargets?: boolean
  /** Embroidery parameters */
  embroidery?: {
    threadThickness?: number
    threadDensity?: number
    threadLength?: number
    threadOffset?: number
    threadScale?: number
    sobelPower?: number
    blur?: number
  }
}

const DEFAULT_EMBROIDERY = {
  threadThickness: 0.55,
  threadDensity: 3.5,
  threadLength: 0.5,
  threadOffset: 25.0,
  threadScale: 1.0,
  sobelPower: 0.25,
  blur: 0.00245,
}

// ── Helpers ─────────────────────────────────────────────────────────────

function computeStats(pixels: Uint8Array, width: number, height: number): PassResult['stats'] {
  let minR = 255, maxR = 0
  let minG = 255, maxG = 0
  let minB = 255, maxB = 0
  let minA = 255, maxA = 0
  let nonZeroPixels = 0
  const totalPixels = width * height

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3]
    minR = Math.min(minR, r); maxR = Math.max(maxR, r)
    minG = Math.min(minG, g); maxG = Math.max(maxG, g)
    minB = Math.min(minB, b); maxB = Math.max(maxB, b)
    minA = Math.min(minA, a); maxA = Math.max(maxA, a)
    if (r > 0 || g > 0 || b > 0 || a > 0) nonZeroPixels++
  }

  return { minR, maxR, minG, maxG, minB, maxB, minA, maxA, nonZeroPixels, totalPixels }
}

function readRT(renderer: WebGLRenderer, rt: WebGLRenderTarget): Uint8Array {
  const pixels = new Uint8Array(rt.width * rt.height * 4)
  renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, pixels)
  return pixels
}

/**
 * Read a FloatType render target as Uint8Array.
 * Uses gl.readPixels with FLOAT type, then clamps/converts to [0,255].
 */
function readFloatRT(renderer: WebGLRenderer, rt: WebGLRenderTarget): Uint8Array {
  const gl = renderer.getContext() as WebGLRenderingContext
  const w = rt.width
  const h = rt.height
  renderer.setRenderTarget(rt)
  const float32 = new Float32Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, float32)
  const uint8 = new Uint8Array(w * h * 4)
  for (let i = 0; i < float32.length; i++) {
    uint8[i] = Math.max(0, Math.min(255, Math.round(float32[i] * 255)))
  }
  return uint8
}

function makeDataTexture(pixels: Uint8Array, width: number, height: number): DataTexture {
  const tex = new DataTexture(pixels.slice(), width, height, RGBAFormat, UnsignedByteType)
  tex.flipY = false
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

const passthroughFrag = /* glsl */ `
  precision mediump float;
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
  }
`

/**
 * Combined Sobel+Blur shader — computes Sobel inline at each blur tap point.
 * This avoids storing Sobel output in a UnsignedByte RT (which clamps values
 * outside [0,1]), keeping full float precision throughout the GPU pipeline.
 *
 * Equivalent to: fxSobelFragmentShader(both=true) → fxBlurFragmentShader
 * but in a single pass with no intermediate storage.
 */
const combinedSobelBlurFrag = /* glsl */ `
precision mediump float;
precision mediump sampler2D;

uniform sampler2D tScene;
uniform vec2 sobelPixelSize;
uniform float sobelPower;
uniform float blur;
varying vec2 vUv;

#define blurSamples 18.0

const vec4 lumaFactor = vec4(0.299, 0.587, 0.114, 0.0);

float random(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 blendLighten(vec3 base, vec3 blend, float opacity) {
  return max(blend, base) * opacity + blend * (1.0 - opacity);
}

// Inline sobel() from fxSobelFragmentShader — non-flip variant only
vec4 inlineSobel(vec2 uv, vec2 dim, float multiplier, float dir) {
  float shadowSum = 0.5;
  vec4 sum = vec4(0.5);
  vec4 center = texture2D(tScene, uv);
  dim *= multiplier;

  shadowSum += texture2D(tScene, uv + vec2(-1.0 * dim.x, 1.0 * dim.y)).a * dir;
  shadowSum += texture2D(tScene, uv + vec2(0.0, 1.0 * dim.y)).a * dir * 2.0;
  shadowSum += texture2D(tScene, uv + vec2(1.0 * dim.x, 1.0 * dim.y)).a * dir;
  shadowSum += texture2D(tScene, uv + vec2(-1.0 * dim.x, 1.0 * dim.y)).a * dir;
  shadowSum += texture2D(tScene, uv + vec2(0.0, 1.0 * dim.y)).a * dir * 2.0;
  shadowSum += texture2D(tScene, uv + vec2(1.0 * dim.x, 1.0 * dim.y)).a * dir;

  sum += texture2D(tScene, uv + vec2(-1.0 * dim.x, 1.0 * dim.y)) * dir;
  sum += texture2D(tScene, uv + vec2(0.0, 1.0 * dim.y)) * dir * 2.0;
  sum += texture2D(tScene, uv + vec2(1.0 * dim.x, 1.0 * dim.y)) * dir;
  sum -= texture2D(tScene, uv + vec2(1.0 * dim.x, 0.0)) * dir;
  sum -= texture2D(tScene, uv + vec2(1.0 * dim.x, -1.0 * dim.y)) * dir * 2.0;
  sum -= texture2D(tScene, uv + vec2(0.0, -1.0 * dim.y)) * dir;
  sum += texture2D(tScene, uv + vec2(-1.0 * dim.x, 1.0 * dim.y)) * dir;
  sum += texture2D(tScene, uv + vec2(0.0, 1.0 * dim.y)) * dir * 2.0;
  sum += texture2D(tScene, uv + vec2(1.0 * dim.x, 1.0 * dim.y)) * dir;
  sum -= texture2D(tScene, uv + vec2(1.0 * dim.x, 0.0)) * dir;
  sum -= texture2D(tScene, uv + vec2(1.0 * dim.x, -1.0 * dim.y)) * dir * 2.0;
  sum -= texture2D(tScene, uv + vec2(0.0, -1.0 * dim.y)) * dir;

  float glum = dot(sum, lumaFactor);
  vec4 shadow = vec4(mix(vec3(0.5), vec3(shadowSum), (1.0 - shadowSum) * (1.0 - center.a)), 1.0);
  vec4 glow = vec4(mix(vec3(0.5), vec3(glum), (1.0 - shadowSum) * center.a), 1.0);
  return vec4(mix(blendLighten(shadow.rgb, glow.rgb, 0.0), glow.rgb, glow.r * 1.5), 1.0);
}

// Inline sobelAlpha() from fxSobelFragmentShader — non-flip variant only
float inlineSobelAlpha(vec2 uv, vec2 dim, float multiplier, float dir) {
  float sum = 0.5;
  dim *= multiplier;

  sum += texture2D(tScene, uv + vec2(-1.0 * dim.x, 1.0 * dim.y)).a * dir;
  sum += texture2D(tScene, uv + vec2(0.0, 1.0 * dim.y)).a * dir * 2.0;
  sum += texture2D(tScene, uv + vec2(1.0 * dim.x, 1.0 * dim.y)).a * dir;
  sum -= texture2D(tScene, uv + vec2(1.0 * dim.x, 0.0)).a * dir;
  sum -= texture2D(tScene, uv + vec2(1.0 * dim.x, -1.0 * dim.y)).a * dir * 2.0;
  sum -= texture2D(tScene, uv + vec2(0.0, -1.0 * dim.y)).a * dir;
  sum += texture2D(tScene, uv + vec2(-1.0 * dim.x, 1.0 * dim.y)).a * dir;
  sum += texture2D(tScene, uv + vec2(0.0, 1.0 * dim.y)).a * dir * 2.0;
  sum += texture2D(tScene, uv + vec2(1.0 * dim.x, 1.0 * dim.y)).a * dir;
  sum -= texture2D(tScene, uv + vec2(1.0 * dim.x, 0.0)).a * dir;
  sum -= texture2D(tScene, uv + vec2(1.0 * dim.x, -1.0 * dim.y)).a * dir * 2.0;
  sum -= texture2D(tScene, uv + vec2(0.0, -1.0 * dim.y)).a * dir;

  return sum;
}

// Compute full Sobel at a given UV (both=true mode: R=sobel, G=sobelAlpha)
vec3 computeSobelAt(vec2 uv) {
  float r = inlineSobel(uv, sobelPixelSize, sobelPower, -0.5).r;
  float g = inlineSobelAlpha(uv, sobelPixelSize, sobelPower + 1.0, -1.0);
  return vec3(r, g, 0.5);
}

void main() {
  // Blur loop (from fxBlurFragmentShader) but computing Sobel inline at each tap
  vec3 outputColor = vec3(0.5);

  for (float i = 0.0; i < blurSamples; i++) {
    float degree = degrees((i / blurSamples) * 360.0);
    vec2 angles = vec2(cos(degree), sin(degree));
    vec2 uvOffset = vUv + (angles * blur * (random(vec2(i, vUv.x + vUv.y))));
    outputColor += computeSobelAt(uvOffset);
  }

  outputColor /= blurSamples;

  // Encode output: map range [-0.5, 1.5] → [0.0, 1.0] for UnsignedByte storage.
  // Decode in blend shader: value * 2.0 - 0.5
  // This preserves Sobel values outside [0,1] through the UnsignedByte RT,
  // giving the blend shader access to the full depth effect range.
  gl_FragColor = vec4(outputColor.rgb * 0.5 + 0.25, 1.0);
}
`

// ── Pipeline ────────────────────────────────────────────────────────────

/**
 * Run the multi-pass embroidery pipeline on a given WebGLRenderer.
 *
 * @param renderer    - A fully initialised Three.js WebGLRenderer
 * @param artworkTex  - Input artwork as a Three.js Texture (already loaded)
 * @param opts        - Pipeline options (sizes, embroidery parameters)
 * @param useDataTextureBetweenPasses - If true, uses manual Sobel+Blur + DataTexture (HeadlessRenderer path).
 *                                      If false, uses EffectComposer ping-pong (browser path).
 */
export function runPipeline(
  renderer: WebGLRenderer,
  artworkTex: Texture,
  opts: PipelineOptions = {},
  useDataTextureBetweenPasses = false,
): PipelineResult {
  const mainSize = opts.mainSize ?? 1024
  const procSize = opts.processingSize ?? 512
  const bufferSamples = opts.bufferSamples ?? 0
  const emb = { ...DEFAULT_EMBROIDERY, ...opts.embroidery }
  const passes: PassResult[] = []
  const deferredDispose: WebGLRenderTarget[] = []

  // ── Fullscreen setup (for shader passes) ──────────────────────────────

  const fsGeometry = new PlaneGeometry(2, 2)
  const fsCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // ── Model scene + camera (for buffer rendering + EffectComposer RenderPass) ──

  const modelCamera = new OrthographicCamera(
    mainSize / -2, mainSize / 2,
    mainSize / 2, mainSize / -2,
    1, 10000,
  )
  modelCamera.position.z = 3000

  const modelScene = new Scene()
  const artworkPlaneMaterial = new ShaderMaterial({
    uniforms: { tDiffuse: { value: artworkTex } },
    vertexShader: modelVertexShader,
    fragmentShader: passthroughFrag,
  })
  const artworkPlane = new Mesh(
    new PlaneGeometry(mainSize, mainSize, 1, 1),
    artworkPlaneMaterial,
  )
  artworkPlane.position.set(0, 0, 0)
  modelScene.add(artworkPlane)

  // ── Render Targets (matching ProductRendererV2.setTextures) ───────────

  // textures.buffer — MSAA, NearestFilter, depth+stencil
  const rtBuffer = new WebGLRenderTarget(mainSize, mainSize, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: true,
    samples: bufferSamples,
  })

  // textures.embroidery — LinearFilter, no depth/stencil
  const rtEmbroidery = new WebGLRenderTarget(mainSize, mainSize, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  })

  // EffectComposer ping-pong RTs (matching composerRenderTarget in setRenderer)
  // Browser uses HalfFloatType, headless uses UnsignedByteType.
  // For the test we use UnsignedByteType for both (readPixels compatibility).
  const composerRT1 = new WebGLRenderTarget(procSize, procSize, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    format: RGBAFormat,
    type: UnsignedByteType,
  })
  const composerRT2 = composerRT1.clone()

  // Final output
  const rtFinal = new WebGLRenderTarget(mainSize, mainSize, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  })

  // ── PASS 0: BUFFER ─────────────────────────────────────────────────
  // Matches: renderer.setRenderTarget(this.textures.buffer)
  //          renderer.render(this.activeGenerator.scenes.buffer, this.cameras.model)

  console.log(`[FBO] Pass 0: BUFFER (${mainSize}x${mainSize}, samples=${bufferSamples})`)
  {
    renderer.setRenderTarget(rtBuffer)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, true)
    renderer.render(modelScene, modelCamera)

    const pixels = readRT(renderer, rtBuffer)
    const stats = computeStats(pixels, mainSize, mainSize)
    console.log(`[FBO]   → nonZero=${stats.nonZeroPixels}/${stats.totalPixels}, alpha=[${stats.minA},${stats.maxA}]`)
    passes.push({ name: 'buffer', pixels, width: mainSize, height: mainSize, stats })
  }

  // ── PASS 1: EMBROIDERY PATTERN ────────────────────────────────────
  // Matches: renderer.setRenderTarget(this.textures.embroidery)
  //          renderer.render(this.activeGenerator.scenes.processing, this.cameras.processing)

  console.log(`[FBO] Pass 1: EMBROIDERY PATTERN (${mainSize}x${mainSize})`)
  {
    const material = new ShaderMaterial({
      uniforms: {
        userLayer: { value: rtBuffer.texture },
        pSize: new Uniform(new Vector2(1.0 / mainSize, 1.0 / mainSize)),
        threadThickness: new Uniform(emb.threadThickness),
        threadDensity: new Uniform(emb.threadDensity),
        threadLength: new Uniform(emb.threadLength),
        threadOffset: new Uniform(emb.threadOffset),
        threadScale: new Uniform(emb.threadScale),
      },
      vertexShader: modelVertexShader,
      fragmentShader: embroideryPatternFragmentShader,
    })
    const mesh = new Mesh(fsGeometry, material)
    const scene = new Scene()
    scene.add(mesh)

    renderer.setRenderTarget(rtEmbroidery)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, true)
    renderer.render(scene, fsCamera)

    const pixels = readRT(renderer, rtEmbroidery)
    const stats = computeStats(pixels, mainSize, mainSize)
    console.log(`[FBO]   → nonZero=${stats.nonZeroPixels}/${stats.totalPixels}, alpha=[${stats.minA},${stats.maxA}]`)
    passes.push({ name: 'embroidery', pixels, width: mainSize, height: mainSize, stats })

    scene.remove(mesh)
    material.dispose()
  }

  // ── PASS 2-3: SOBEL + BLUR ─────────────────────────────────────────

  let processedTex: Texture
  let embTex: Texture = rtEmbroidery.texture

  if (opts.useFloatRenderTargets) {
    // ════════════════════════════════════════════════════════════════════
    // "FLOAT RT" PATH — Standard two-pass Sobel→Blur with FloatType RTs
    //
    // headless-gl supports OES_texture_float + OES_texture_float_linear,
    // and FloatType FBOs are FRAMEBUFFER_COMPLETE. This means we can use
    // 32-bit float render targets for the Sobel→Blur pipeline, preserving
    // values outside [0,1] just like the browser's HalfFloat RTs.
    //
    // This gives the SAME mathematical operation as the browser:
    //   Sobel(scene) → FloatRT → Blur(SobelRT) → FloatRT → blend
    // vs browser:
    //   Sobel(scene) → HalfFloatRT → Blur(SobelRT) → HalfFloatRT → blend
    // ════════════════════════════════════════════════════════════════════

    const sceneRT = new WebGLRenderTarget(procSize, procSize, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: true,
    })
    const rtSobelFloat = new WebGLRenderTarget(procSize, procSize, {
      format: RGBAFormat,
      type: FloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    })
    const rtBlurFloat = new WebGLRenderTarget(procSize, procSize, {
      format: RGBAFormat,
      type: FloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    })

    console.log(`[FBO] Pass 2-3: FLOAT RT TWO-PASS (${procSize}x${procSize})`)

    // Step 1: Render scene at procSize (like EffectComposer's RenderPass)
    console.log(`[FBO]   Step 1: RenderPass → sceneRT (${procSize}x${procSize})`)
    {
      renderer.setRenderTarget(sceneRT)
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, true, true)
      renderer.render(modelScene, modelCamera)
    }

    // Step 2: Sobel → FloatType RT (preserves values outside [0,1])
    console.log(`[FBO]   Step 2: Sobel → rtSobelFloat (FloatType)`)
    {
      const material = new ShaderMaterial({
        uniforms: {
          tDiffuse: { value: sceneRT.texture },
          pixelSize: new Uniform(new Vector2(1.0 / procSize, 1.0 / procSize)),
          edge: new Uniform(false),
          both: new Uniform(true),
          power: new Uniform(emb.sobelPower),
        },
        vertexShader: modelVertexShader,
        fragmentShader: fxSobelFragmentShader,
      })
      const mesh = new Mesh(fsGeometry, material)
      const scene = new Scene()
      scene.add(mesh)

      renderer.setRenderTarget(rtSobelFloat)
      renderer.setClearColor(0x808080, 1)
      renderer.clear(true, true, true)
      renderer.render(scene, fsCamera)

      // Read as Uint8 for comparison (clamps to [0,255])
      const pixels = readFloatRT(renderer, rtSobelFloat)
      const stats = computeStats(pixels, procSize, procSize)
      console.log(`[FBO]   Sobel → nonZero=${stats.nonZeroPixels}/${stats.totalPixels}, R=[${stats.minR},${stats.maxR}], G=[${stats.minG},${stats.maxG}]`)
      passes.push({ name: 'sobel', pixels, width: procSize, height: procSize, stats })

      scene.remove(mesh)
      material.dispose()
    }

    // Step 3: Blur → FloatType RT (reads from Sobel float RT)
    console.log(`[FBO]   Step 3: Blur → rtBlurFloat (FloatType)`)
    {
      const material = new ShaderMaterial({
        uniforms: {
          tDiffuse: { value: rtSobelFloat.texture },
          blur: { value: emb.blur },
        },
        vertexShader: modelVertexShader,
        fragmentShader: fxBlurFragmentShader,
      })
      const mesh = new Mesh(fsGeometry, material)
      const scene = new Scene()
      scene.add(mesh)

      renderer.setRenderTarget(rtBlurFloat)
      renderer.setClearColor(0x808080, 1)
      renderer.clear(true, true, true)
      renderer.render(scene, fsCamera)

      // Read as Uint8 for comparison
      const pixels = readFloatRT(renderer, rtBlurFloat)
      const stats = computeStats(pixels, procSize, procSize)
      console.log(`[FBO]   Blur → nonZero=${stats.nonZeroPixels}/${stats.totalPixels}, R=[${stats.minR},${stats.maxR}]`)
      passes.push({ name: 'blur', pixels, width: procSize, height: procSize, stats })

      scene.remove(mesh)
      material.dispose()
    }

    // Use RT textures directly for the blend pass
    processedTex = rtBlurFloat.texture

    deferredDispose.push(sceneRT, rtSobelFloat, rtBlurFloat)

  } else if (opts.useCombinedSobelBlur) {
    // ════════════════════════════════════════════════════════════════════
    // "COMBINED" PATH — Single-pass Sobel+Blur for headless-gl
    //
    // headless-gl can't use HalfFloat RTs, so storing Sobel output in
    // a UnsignedByte RT clamps values outside [0,1], destroying depth.
    // The combined shader computes Sobel inline at each blur tap point,
    // keeping full float precision throughout the GPU pipeline.
    //
    // Flow:
    //   1. Re-render scene at procSize (like EffectComposer's RenderPass)
    //   2. Standard Sobel pass for comparison capture (UnsignedByte clamped)
    //   3. Combined Sobel+Blur → processedLayer (full float precision)
    // ════════════════════════════════════════════════════════════════════

    const sceneRT = new WebGLRenderTarget(procSize, procSize, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: true,
    })
    const rtSobel = new WebGLRenderTarget(procSize, procSize, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    })
    const rtCombined = new WebGLRenderTarget(procSize, procSize, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    })

    // Step 1: Render scene at procSize (like EffectComposer's RenderPass)
    console.log(`[FBO] Pass 2-3: COMBINED SOBEL+BLUR (${procSize}x${procSize})`)
    console.log(`[FBO]   Step 1: RenderPass → sceneRT (${procSize}x${procSize})`)
    {
      renderer.setRenderTarget(sceneRT)
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, true, true)
      renderer.render(modelScene, modelCamera)
    }

    // Step 2: Standard Sobel for comparison capture (clamped to [0,1])
    console.log(`[FBO]   Step 2: Sobel pass → rtSobel (comparison capture)`)
    {
      const material = new ShaderMaterial({
        uniforms: {
          tDiffuse: { value: sceneRT.texture },
          pixelSize: new Uniform(new Vector2(1.0 / procSize, 1.0 / procSize)),
          edge: new Uniform(false),
          both: new Uniform(true),
          power: new Uniform(emb.sobelPower),
        },
        vertexShader: modelVertexShader,
        fragmentShader: fxSobelFragmentShader,
      })
      const mesh = new Mesh(fsGeometry, material)
      const scene = new Scene()
      scene.add(mesh)

      renderer.setRenderTarget(rtSobel)
      renderer.setClearColor(0x808080, 1)
      renderer.clear(true, true, true)
      renderer.render(scene, fsCamera)

      const pixels = readRT(renderer, rtSobel)
      const stats = computeStats(pixels, procSize, procSize)
      console.log(`[FBO]   Sobel → nonZero=${stats.nonZeroPixels}/${stats.totalPixels}, R=[${stats.minR},${stats.maxR}], G=[${stats.minG},${stats.maxG}]`)
      passes.push({ name: 'sobel', pixels, width: procSize, height: procSize, stats })

      scene.remove(mesh)
      material.dispose()
    }

    // Step 3: Combined Sobel+Blur — full float precision in GPU pipeline
    console.log(`[FBO]   Step 3: Combined Sobel+Blur → rtCombined`)
    {
      const material = new ShaderMaterial({
        uniforms: {
          tScene: { value: sceneRT.texture },
          sobelPixelSize: new Uniform(new Vector2(1.0 / procSize, 1.0 / procSize)),
          sobelPower: new Uniform(emb.sobelPower),
          blur: { value: emb.blur },
        },
        vertexShader: modelVertexShader,
        fragmentShader: combinedSobelBlurFrag,
      })
      const mesh = new Mesh(fsGeometry, material)
      const scene = new Scene()
      scene.add(mesh)

      renderer.setRenderTarget(rtCombined)
      renderer.setClearColor(0x808080, 1)
      renderer.clear(true, true, true)
      renderer.render(scene, fsCamera)

      // Read encoded pixels and decode for comparison
      // Encoding: encoded = value * 0.5 + 0.25
      // Decoding: value = encoded * 2.0 - 0.5
      const encodedPixels = readRT(renderer, rtCombined)
      const decodedPixels = new Uint8Array(encodedPixels.length)
      for (let i = 0; i < encodedPixels.length; i += 4) {
        // Decode RGB channels, keep alpha
        decodedPixels[i]     = Math.max(0, Math.min(255, Math.round(encodedPixels[i]     * 2 - 127.5)))
        decodedPixels[i + 1] = Math.max(0, Math.min(255, Math.round(encodedPixels[i + 1] * 2 - 127.5)))
        decodedPixels[i + 2] = Math.max(0, Math.min(255, Math.round(encodedPixels[i + 2] * 2 - 127.5)))
        decodedPixels[i + 3] = encodedPixels[i + 3]
      }
      const stats = computeStats(decodedPixels, procSize, procSize)
      console.log(`[FBO]   Combined → nonZero=${stats.nonZeroPixels}/${stats.totalPixels}, R=[${stats.minR},${stats.maxR}], G=[${stats.minG},${stats.maxG}]`)
      passes.push({ name: 'blur', pixels: decodedPixels, width: procSize, height: procSize, stats })

      scene.remove(mesh)
      material.dispose()
    }

    // Use RT textures directly (no DataTexture workaround needed —
    // FBO debug confirmed headless-gl FBO sampling works correctly)
    processedTex = rtCombined.texture
    // embTex stays as rtEmbroidery.texture (default)

    // Defer disposal to cleanup section (RTs still needed for final pass)
    deferredDispose.push(sceneRT, rtSobel, rtCombined)

  } else if (!useDataTextureBetweenPasses) {
    // ════════════════════════════════════════════════════════════════════
    // "COMPOSER" PATH — EffectComposer ping-pong (what browser does)
    //
    // Replicates EffectComposer behavior:
    //   writeBuffer = composerRT1, readBuffer = composerRT2
    //   1. RenderPass: scene → readBuffer (needsSwap=false, no swap)
    //      NOTE: Three.js RenderPass renders to readBuffer, NOT writeBuffer!
    //   2. SobelPass: tDiffuse=readBuffer.texture(scene) → writeBuffer (swap)
    //   3. BlurPass:  tDiffuse=readBuffer.texture(sobel) → writeBuffer (swap)
    //   Result: readBuffer.texture = blur output
    // ════════════════════════════════════════════════════════════════════

    let writeBuffer = composerRT1
    let readBuffer = composerRT2

    // Step A: "RenderPass" — render model scene to readBuffer (not writeBuffer!)
    // Three.js RenderPass.render() calls renderer.setRenderTarget(readBuffer)
    // with needsSwap=false, so no swap after.
    console.log(`[FBO] Pass 2-3: COMPOSER PING-PONG (${procSize}x${procSize})`)
    console.log(`[FBO]   Step A: RenderPass → readBuffer (no swap)`)
    {
      renderer.setRenderTarget(readBuffer)
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, true, true)
      renderer.render(modelScene, modelCamera)
      // RenderPass.needsSwap = false → no swap
    }

    // Step B: "SobelPass" — reads readBuffer (scene data), writes writeBuffer
    console.log(`[FBO]   Step B: SobelPass — tDiffuse=readBuffer(scene) → writeBuffer (swap)`)
    {
      const material = new ShaderMaterial({
        uniforms: {
          tDiffuse: { value: readBuffer.texture },
          pixelSize: new Uniform(new Vector2(1.0 / procSize, 1.0 / procSize)),
          edge: new Uniform(false),
          both: new Uniform(true),
          power: new Uniform(emb.sobelPower),
        },
        vertexShader: modelVertexShader,
        fragmentShader: fxSobelFragmentShader,
      })
      const mesh = new Mesh(fsGeometry, material)
      const scene = new Scene()
      scene.add(mesh)

      renderer.setRenderTarget(writeBuffer)
      renderer.render(scene, fsCamera)
      // ShaderPass.needsSwap = true → swap
      ;[writeBuffer, readBuffer] = [readBuffer, writeBuffer]

      scene.remove(mesh)
      material.dispose()
    }

    // Capture sobel output
    const sobelPixels = readRT(renderer, readBuffer)
    const sobelStats = computeStats(sobelPixels, procSize, procSize)
    console.log(`[FBO]   Sobel → nonZero=${sobelStats.nonZeroPixels}/${sobelStats.totalPixels}, R=[${sobelStats.minR},${sobelStats.maxR}], G=[${sobelStats.minG},${sobelStats.maxG}]`)
    passes.push({ name: 'sobel', pixels: sobelPixels, width: procSize, height: procSize, stats: sobelStats })

    // Step C: "BlurPass" — reads readBuffer, writes writeBuffer
    console.log(`[FBO]   Step C: BlurPass — tDiffuse=readBuffer → writeBuffer (swap)`)
    {
      const material = new ShaderMaterial({
        uniforms: {
          tDiffuse: { value: readBuffer.texture },
          blur: { value: emb.blur },
        },
        vertexShader: modelVertexShader,
        fragmentShader: fxBlurFragmentShader,
      })
      const mesh = new Mesh(fsGeometry, material)
      const scene = new Scene()
      scene.add(mesh)

      renderer.setRenderTarget(writeBuffer)
      renderer.render(scene, fsCamera)
      ;[writeBuffer, readBuffer] = [readBuffer, writeBuffer]

      scene.remove(mesh)
      material.dispose()
    }

    // Capture blur output
    const blurPixels = readRT(renderer, readBuffer)
    const blurStats = computeStats(blurPixels, procSize, procSize)
    console.log(`[FBO]   Blur → nonZero=${blurStats.nonZeroPixels}/${blurStats.totalPixels}, R=[${blurStats.minR},${blurStats.maxR}]`)
    passes.push({ name: 'blur', pixels: blurPixels, width: procSize, height: procSize, stats: blurStats })

    // processedLayer = composer readBuffer (matches: this.composer.readBuffer.texture)
    processedTex = readBuffer.texture

  } else {
    // ════════════════════════════════════════════════════════════════════
    // "PATCHED" PATH — Manual Sobel+Blur (what HeadlessRenderer does)
    //
    // HeadlessRenderer.patchDrawBufferForHeadless() runs the original
    // drawBuffer (EffectComposer), then OVERRIDES with manual fullscreen-
    // quad Sobel+Blur reading directly from buffer texture, plus
    // DataTexture GPU→CPU→GPU workaround.
    // ════════════════════════════════════════════════════════════════════

    // Use separate RTs for manual passes
    const rtSobel = new WebGLRenderTarget(procSize, procSize, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    })
    const rtBlur = new WebGLRenderTarget(procSize, procSize, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    })

    // Sobel: reads directly from buffer texture
    console.log(`[FBO] Pass 2: SOBEL — manual (${procSize}x${procSize})`)
    {
      const material = new ShaderMaterial({
        uniforms: {
          tDiffuse: { value: rtBuffer.texture },
          pixelSize: new Uniform(new Vector2(1.0 / procSize, 1.0 / procSize)),
          edge: new Uniform(false),
          both: new Uniform(true),
          power: new Uniform(emb.sobelPower),
        },
        vertexShader: modelVertexShader,
        fragmentShader: fxSobelFragmentShader,
      })
      const mesh = new Mesh(fsGeometry, material)
      const scene = new Scene()
      scene.add(mesh)

      renderer.setRenderTarget(rtSobel)
      renderer.setClearColor(0x808080, 1)
      renderer.clear(true, true, true)
      renderer.render(scene, fsCamera)

      const pixels = readRT(renderer, rtSobel)
      const stats = computeStats(pixels, procSize, procSize)
      console.log(`[FBO]   → nonZero=${stats.nonZeroPixels}/${stats.totalPixels}, R=[${stats.minR},${stats.maxR}], G=[${stats.minG},${stats.maxG}]`)
      passes.push({ name: 'sobel', pixels, width: procSize, height: procSize, stats })

      scene.remove(mesh)
      material.dispose()
    }

    // Blur: reads from sobel output
    console.log(`[FBO] Pass 3: BLUR — manual (${procSize}x${procSize})`)
    {
      const material = new ShaderMaterial({
        uniforms: {
          tDiffuse: { value: rtSobel.texture },
          blur: { value: emb.blur },
        },
        vertexShader: modelVertexShader,
        fragmentShader: fxBlurFragmentShader,
      })
      const mesh = new Mesh(fsGeometry, material)
      const scene = new Scene()
      scene.add(mesh)

      renderer.setRenderTarget(rtBlur)
      renderer.setClearColor(0x808080, 1)
      renderer.clear(true, true, true)
      renderer.render(scene, fsCamera)

      const pixels = readRT(renderer, rtBlur)
      const stats = computeStats(pixels, procSize, procSize)
      console.log(`[FBO]   → nonZero=${stats.nonZeroPixels}/${stats.totalPixels}, R=[${stats.minR},${stats.maxR}]`)
      passes.push({ name: 'blur', pixels, width: procSize, height: procSize, stats })

      scene.remove(mesh)
      material.dispose()
    }

    // DataTexture workaround: GPU→CPU→GPU roundtrip
    console.log(`[FBO]   → Applying DataTexture workaround for processedLayer + embLayer`)
    const blurPixels = readRT(renderer, rtBlur)
    processedTex = makeDataTexture(blurPixels, procSize, procSize)

    const embPixels = readRT(renderer, rtEmbroidery)
    embTex = makeDataTexture(embPixels, mainSize, mainSize)

    rtSobel.dispose()
    rtBlur.dispose()
  }

  // ── PASS 4: FINAL COMPOSITION ─────────────────────────────────────
  // Matches GeneratorInstance.setPreviewPlane():
  //   Plane 1 (z=-100): embroideryShaderBase — opaque base
  //   Plane 2 (z=-50):  embroideryShaderBlend — transparent thread overlay
  // Camera: orthographic(cameraSize), position.z=1

  console.log(`[FBO] Pass 4: BASE+BLEND COMPOSITION (${mainSize}x${mainSize})`)
  {
    const whitePixels = new Uint8Array([255, 255, 255, 255])
    const whiteTex = new DataTexture(whitePixels, 1, 1, RGBAFormat, UnsignedByteType)
    whiteTex.needsUpdate = true

    const blackPixels = new Uint8Array([0, 0, 0, 0])
    const blackTex = new DataTexture(blackPixels, 1, 1, RGBAFormat, UnsignedByteType)
    blackTex.needsUpdate = true

    // Shared uniforms matching predefinedRenderingFlow.ts EMBROIDERY case
    const sharedUniforms: Record<string, Uniform | { value: any }> = {
      pixelSize: new Uniform(new Vector2(1.0 / mainSize, 1.0 / mainSize)),
      color: new Uniform(new Color(0xffffff)),
      secondaryColor: new Uniform(new Color(0x808080)),
      secondarySaturation: new Uniform(0.5),
      secondaryBrightness: new Uniform(0.0),
      secondaryContrast: new Uniform(1.0),
      secondaryGamma: new Uniform(1.0),
      isBgTransparent: new Uniform(false),
      maskBlurStrength: new Uniform(1.0),
      maskErosionStart: new Uniform(0.7),
      maskErosionEnd: new Uniform(1.0),
      isMulticolor: new Uniform(false),
      layerUsed: new Uniform(0),
      hl: new Uniform(0.5),
      hr: new Uniform(0.5),
      sa: new Uniform(1.0),
      sh: new Uniform(0.001),
      cv: new Uniform(1.0),
      bv: new Uniform(0.0),
      gv: new Uniform(1.0),
      mixValue: new Uniform(1.0),
      baseLayer: new Uniform(whiteTex),
      maskLayer: new Uniform(whiteTex),
      optionalLayer: new Uniform(blackTex),
      userLayer: new Uniform(rtBuffer.texture),
      embLayer: new Uniform(embTex),
      processedLayer: new Uniform(processedTex),
      isHeather: new Uniform(false),
      textureAmount: new Uniform(1.0),
      heatherScale: new Uniform(2.0),
      heatherAngle: new Uniform(0.0),
      heatherTexture: new Uniform(whiteTex),
    }

    const compositeCamera = new OrthographicCamera(
      mainSize / -2, mainSize / 2,
      mainSize / 2, mainSize / -2,
      1, 10000,
    )
    compositeCamera.position.z = 1

    const compositeScene = new Scene()
    const planeGeometry = new PlaneGeometry(mainSize, mainSize, 1, 1)

    // Plane 1: Base layer (opaque, z=-100)
    const baseMaterial = new ShaderMaterial({
      uniforms: sharedUniforms,
      vertexShader: basicVertexShader,
      fragmentShader: embroideryShaderBaseFrag,
      glslVersion: GLSL1,
      transparent: false,
    })
    baseMaterial.needsUpdate = true
    const basePlane = new Mesh(planeGeometry, baseMaterial)
    basePlane.position.set(0, 0, -100.0)
    compositeScene.add(basePlane)

    // Plane 2: Blend layer (transparent, custom blending, z=-50)
    // When using combined Sobel+Blur with encoding, decode processedLayer in blend shader:
    // encoded = value * 0.5 + 0.25 → decode: value = encoded * 2.0 - 0.5
    const blendFragShader = opts.useCombinedSobelBlur
      ? embroideryShaderBlendFrag.replace(
          'vec4 processed = texture2D( processedLayer, vUv );',
          'vec4 processed = texture2D( processedLayer, vUv );\n  processed.rgb = processed.rgb * 2.0 - 0.5;',
        )
      : embroideryShaderBlendFrag
    const blendMaterial = new ShaderMaterial({
      uniforms: sharedUniforms,
      vertexShader: basicVertexShader,
      fragmentShader: blendFragShader,
      glslVersion: GLSL1,
      transparent: true,
      premultipliedAlpha: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: DstAlphaFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: SrcAlphaFactor,
      blendDstAlpha: OneFactor,
    })
    blendMaterial.needsUpdate = true
    const blendPlane = new Mesh(planeGeometry, blendMaterial)
    blendPlane.position.set(0, 0, -50.0)
    compositeScene.add(blendPlane)

    renderer.setRenderTarget(rtFinal)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, true)
    renderer.render(compositeScene, compositeCamera)

    const pixels = readRT(renderer, rtFinal)
    const stats = computeStats(pixels, mainSize, mainSize)
    console.log(`[FBO]   → nonZero=${stats.nonZeroPixels}/${stats.totalPixels}, alpha=[${stats.minA},${stats.maxA}]`)
    passes.push({ name: 'final', pixels, width: mainSize, height: mainSize, stats })

    compositeScene.remove(basePlane)
    compositeScene.remove(blendPlane)
    baseMaterial.dispose()
    blendMaterial.dispose()
    planeGeometry.dispose()
    whiteTex.dispose()
    blackTex.dispose()
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  rtBuffer.dispose()
  rtEmbroidery.dispose()
  composerRT1.dispose()
  composerRT2.dispose()
  rtFinal.dispose()
  fsGeometry.dispose()
  artworkPlaneMaterial.dispose()
  for (const rt of deferredDispose) rt.dispose()

  return { passes }
}
