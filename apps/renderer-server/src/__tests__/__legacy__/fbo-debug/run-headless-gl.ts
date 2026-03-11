/**
 * Path B: headless-gl runner
 *
 * Creates a headless WebGL context via the `gl` package (same as HeadlessRenderer.ts)
 * and runs the FBO pipeline through it.
 *
 * IMPORTANT: headless-gl crashes (SEGFAULT) if you create and destroy multiple
 * GL contexts in a single process. So we keep a single context alive and
 * re-run the pipeline with different options.
 *
 * Supports multiple variants for testing different workaround strategies:
 *   - Variant A (direct): Direct renderTarget.texture (default Three.js behaviour)
 *   - Variant B (data-texture): readPixels → DataTexture between passes (current workaround)
 *   - Variant C (gl-finish): glFinish() between passes
 *   - Variant D (unbind-fbo): unbind FBO (setRenderTarget(null)) between passes
 */

import createGL from 'gl'
import { createCanvas } from 'canvas'
import {
  WebGLRenderer,
  DataTexture,
  RGBAFormat,
  UnsignedByteType,
  LinearFilter,
  ClampToEdgeWrapping,
} from 'three'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'
import { runPipeline, type PipelineResult, type PipelineOptions } from './fbo-pipeline.js'

const __dirname_local = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname_local, '../__fixtures__')

export type HeadlessGLVariant = 'direct' | 'data-texture' | 'gl-finish' | 'unbind-fbo'

// ── Singleton context ───────────────────────────────────────────────────

let _renderer: WebGLRenderer | null = null
let _rawGL: any = null

function getOrCreateRenderer(size: number): { renderer: WebGLRenderer; rawGL: any } {
  if (_renderer && _rawGL) {
    return { renderer: _renderer, rawGL: _rawGL }
  }

  const canvas = createCanvas(size, size) as any

  const rawGL = createGL(size, size, {
    alpha: true,
    depth: true,
    stencil: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  })

  if (!rawGL) {
    throw new Error('Failed to create headless-gl context')
  }

  const originalGetContext = canvas.getContext.bind(canvas)
  canvas.getContext = function (contextType: string, _options?: any) {
    if (contextType === 'webgl' || contextType === 'webgl2') {
      return rawGL
    }
    return originalGetContext(contextType, _options)
  }

  canvas.addEventListener = () => {}
  canvas.removeEventListener = () => {}
  canvas.style = {}
  Object.defineProperty(canvas, 'clientWidth', { get: () => size })
  Object.defineProperty(canvas, 'clientHeight', { get: () => size })

  const renderer = new WebGLRenderer({
    canvas,
    context: rawGL as any,
    alpha: true,
    depth: true,
    stencil: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  })

  renderer.setSize(size, size)
  renderer.setPixelRatio(1)

  _renderer = renderer
  _rawGL = rawGL

  return { renderer, rawGL }
}

/** Destroy the singleton GL context. Call only once at the very end. */
export function destroyHeadlessGL(): void {
  if (_renderer) {
    try {
      _renderer.dispose()
    } catch {
      // Three.js dispose() may fail in headless (no cancelAnimationFrame) — safe to ignore
    }
    _renderer = null
  }
  if (_rawGL) {
    try {
      _rawGL.getExtension('STACKGL_destroy_context')?.destroy()
    } catch {
      // Safe to ignore
    }
    _rawGL = null
  }
}

// ── Artwork Loading ─────────────────────────────────────────────────────

function loadArtworkTexture(artworkPath: string): DataTexture {
  const pngBuffer = readFileSync(artworkPath)
  const png = PNG.sync.read(pngBuffer)

  const tex = new DataTexture(
    new Uint8Array(png.data),
    png.width,
    png.height,
    RGBAFormat,
    UnsignedByteType,
  )
  tex.flipY = false
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

// ── Public API ──────────────────────────────────────────────────────────

export interface HeadlessGLRunOptions extends PipelineOptions {
  variant?: HeadlessGLVariant
  artworkPath?: string
  contextSize?: number
}

export function runHeadlessGL(opts: HeadlessGLRunOptions = {}): PipelineResult {
  const variant = opts.variant ?? 'direct'
  const artworkPath = opts.artworkPath ?? join(FIXTURES_DIR, 'test-artwork.png')
  const contextSize = opts.contextSize ?? opts.mainSize ?? 1024

  console.log(`\n${'='.repeat(60)}`)
  console.log(`[headless-gl] variant=${variant}, contextSize=${contextSize}`)
  console.log(`${'='.repeat(60)}\n`)

  const { renderer, rawGL } = getOrCreateRenderer(contextSize)

  const artworkTex = loadArtworkTexture(artworkPath)
  const useDataTexture = variant === 'data-texture'

  // For direct variant, use FloatType render targets for the Sobel→Blur pipeline.
  // headless-gl supports OES_texture_float + FloatType FBOs, giving 32-bit precision
  // (even better than the browser's 16-bit HalfFloat). This allows using the standard
  // two-pass pipeline without the combined shader or encoding workarounds.
  if (variant === 'direct' && opts.useFloatRenderTargets === undefined) {
    opts.useFloatRenderTargets = true
  }

  // For gl-finish and unbind-fbo variants, temporarily monkey-patch the renderer.
  // We save and restore the original methods after the pipeline run.
  const origRender = renderer.render.bind(renderer)
  const origSetRT = renderer.setRenderTarget.bind(renderer)

  if (variant === 'gl-finish') {
    renderer.render = function (scene: any, camera: any) {
      origRender(scene, camera)
      rawGL.finish()
    } as any
  }

  if (variant === 'unbind-fbo') {
    renderer.render = function (scene: any, camera: any) {
      origRender(scene, camera)
      origSetRT(null)
    } as any
  }

  try {
    const result = runPipeline(renderer, artworkTex, opts, useDataTexture)
    artworkTex.dispose()
    return result
  } finally {
    // Restore original methods
    renderer.render = origRender as any
    renderer.setRenderTarget = origSetRT

    // Clear state for next run
    renderer.setRenderTarget(null)
    renderer.clear(true, true, true)
  }
}
