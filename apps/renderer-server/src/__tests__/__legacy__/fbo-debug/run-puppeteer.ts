/**
 * Path A: Puppeteer (headless Chrome) runner — reference / ground truth
 *
 * Launches headless Chrome, injects Three.js + shaders via page.evaluate(),
 * and runs the identical EffectComposer-based pipeline with full WebGL2 + real GPU.
 *
 * Matches ProductRendererV2.drawBuffer 1:1:
 * - Buffer RT with MSAA (samples:2)
 * - EffectComposer ping-pong for Sobel+Blur (RenderPass + ShaderPass + ShaderPass)
 * - Proper RT filters (NearestFilter for buffer, LinearFilter for others)
 */

import puppeteer, { type Browser } from 'puppeteer'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { PassResult, PipelineResult, PipelineOptions } from './fbo-pipeline.js'

const __dirname_local = dirname(fileURLToPath(import.meta.url))
const SHADER_DIR = join(__dirname_local, '../../../../../product-renderer/src/shaders')
const FIXTURES_DIR = join(__dirname_local, '../__fixtures__')

function loadShader(filename: string): string {
  return readFileSync(join(SHADER_DIR, filename), 'utf-8')
}

const SHADERS = {
  modelVertexShader: loadShader('modelVertexShader.vert.glsl'),
  basicVertexShader: loadShader('basicVertexShader.vert.glsl'),
  embroideryPatternFragmentShader: loadShader('embroideryPatternFragmentShader.frag.glsl'),
  fxSobelFragmentShader: loadShader('fxSobelFragmentShader.frag.glsl'),
  fxBlurFragmentShader: loadShader('fxBlurFragmentShader.frag.glsl'),
  embroideryShaderBlend: loadShader('embroideryShaderBlend.frag.glsl'),
  embroideryShaderBase: loadShader('embroideryShaderBase.frag.glsl'),
}

export interface PuppeteerRunOptions extends PipelineOptions {
  artworkPath?: string
}

export async function runPuppeteer(opts: PuppeteerRunOptions = {}): Promise<PipelineResult> {
  const artworkPath = opts.artworkPath ?? join(FIXTURES_DIR, 'test-artwork.png')
  const mainSize = opts.mainSize ?? 1024
  const procSize = opts.processingSize ?? 512
  const bufferSamples = opts.bufferSamples ?? 2

  const embroidery = {
    threadThickness: opts.embroidery?.threadThickness ?? 0.55,
    threadDensity: opts.embroidery?.threadDensity ?? 3.5,
    threadLength: opts.embroidery?.threadLength ?? 0.5,
    threadOffset: opts.embroidery?.threadOffset ?? 25.0,
    threadScale: opts.embroidery?.threadScale ?? 1.0,
    sobelPower: opts.embroidery?.sobelPower ?? 0.25,
    blur: opts.embroidery?.blur ?? 0.00245,
  }

  const artworkBase64 = readFileSync(artworkPath).toString('base64')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`[Puppeteer] mainSize=${mainSize}, procSize=${procSize}, bufferSamples=${bufferSamples}`)
  console.log(`${'='.repeat(60)}\n`)

  let browser: Browser | undefined
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--use-gl=angle',
        '--enable-webgl',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    })

    const page = await browser.newPage()
    await page.setViewport({ width: mainSize, height: mainSize })
    await page.goto('about:blank')

    await page.addScriptTag({
      url: 'https://unpkg.com/three@0.158.0/build/three.js',
    })

    const result = await page.evaluate(
      (
        shaders: typeof SHADERS,
        artworkB64: string,
        mSize: number,
        pSize: number,
        bSamples: number,
        emb: typeof embroidery,
      ) => {
        const THREE = (window as any).THREE

        // ── Helpers ──────────────────────────────────────────────────

        function loadArtworkFromBase64(b64: string): Promise<any> {
          return new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => {
              const canvas = document.createElement('canvas')
              canvas.width = img.width
              canvas.height = img.height
              const ctx = canvas.getContext('2d')!
              ctx.drawImage(img, 0, 0)
              const imageData = ctx.getImageData(0, 0, img.width, img.height)
              const tex = new THREE.DataTexture(
                new Uint8Array(imageData.data),
                img.width, img.height,
                THREE.RGBAFormat, THREE.UnsignedByteType,
              )
              tex.flipY = false
              tex.minFilter = THREE.LinearFilter
              tex.magFilter = THREE.LinearFilter
              tex.wrapS = THREE.ClampToEdgeWrapping
              tex.wrapT = THREE.ClampToEdgeWrapping
              tex.needsUpdate = true
              resolve(tex)
            }
            img.onerror = reject
            img.src = `data:image/png;base64,${b64}`
          })
        }

        function computeStats(pixels: Uint8Array, width: number, height: number) {
          let minR = 255, maxR = 0, minG = 255, maxG = 0
          let minB = 255, maxB = 0, minA = 255, maxA = 0
          let nonZeroPixels = 0
          const totalPixels = width * height
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i], g = pixels[i+1], b = pixels[i+2], a = pixels[i+3]
            minR = Math.min(minR, r); maxR = Math.max(maxR, r)
            minG = Math.min(minG, g); maxG = Math.max(maxG, g)
            minB = Math.min(minB, b); maxB = Math.max(maxB, b)
            minA = Math.min(minA, a); maxA = Math.max(maxA, a)
            if (r > 0 || g > 0 || b > 0 || a > 0) nonZeroPixels++
          }
          return { minR, maxR, minG, maxG, minB, maxB, minA, maxA, nonZeroPixels, totalPixels }
        }

        function readRT(renderer: any, rt: any): Uint8Array {
          const pixels = new Uint8Array(rt.width * rt.height * 4)
          renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, pixels)
          return pixels
        }

        // Read HalfFloat RT via WebGL2 readPixels(GL_FLOAT) → clamp to Uint8Array
        function readHalfFloatRT(renderer: any, rt: any): Uint8Array {
          const gl = renderer.getContext()
          const w = rt.width, h = rt.height
          renderer.setRenderTarget(rt)
          const float32 = new Float32Array(w * h * 4)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, float32)
          const uint8 = new Uint8Array(w * h * 4)
          for (let i = 0; i < float32.length; i++) {
            uint8[i] = Math.max(0, Math.min(255, Math.round(float32[i] * 255)))
          }
          return uint8
        }

        const passthroughFrag = `
          precision mediump float;
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
        `

        // ── Main pipeline ───────────────────────────────────────────
        return (async () => {
          const artworkTex = await loadArtworkFromBase64(artworkB64)

          // Create renderer
          const canvas = document.createElement('canvas')
          canvas.width = mSize
          canvas.height = mSize
          document.body.appendChild(canvas)

          const renderer = new THREE.WebGLRenderer({
            canvas,
            alpha: true,
            depth: true,
            stencil: true,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true,
          })
          renderer.setSize(mSize, mSize)
          renderer.setPixelRatio(1)

          const passes: any[] = []

          // ── Fullscreen setup ────────────────────────────────────
          const fsGeometry = new THREE.PlaneGeometry(2, 2)
          const fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

          // ── Model scene + camera ────────────────────────────────
          const modelCamera = new THREE.OrthographicCamera(
            mSize / -2, mSize / 2, mSize / 2, mSize / -2, 1, 10000,
          )
          modelCamera.position.z = 3000

          const modelScene = new THREE.Scene()
          const artworkPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(mSize, mSize, 1, 1),
            new THREE.ShaderMaterial({
              uniforms: { tDiffuse: { value: artworkTex } },
              vertexShader: shaders.modelVertexShader,
              fragmentShader: passthroughFrag,
            }),
          )
          artworkPlane.position.set(0, 0, 0)
          modelScene.add(artworkPlane)

          // ── Render Targets ──────────────────────────────────────

          // Buffer: MSAA, NearestFilter, depth+stencil
          const rtBuffer = new THREE.WebGLRenderTarget(mSize, mSize, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            generateMipmaps: false,
            depthBuffer: true,
            stencilBuffer: true,
            samples: bSamples,
          })

          // Embroidery: LinearFilter
          const rtEmbroidery = new THREE.WebGLRenderTarget(mSize, mSize, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            generateMipmaps: false,
            depthBuffer: false,
            stencilBuffer: false,
          })

          // EffectComposer ping-pong RTs — HalfFloatType matches browser's EffectComposer
          // (ProductRendererV2.setRenderer creates composerRenderTarget with HalfFloatType)
          // This preserves Sobel output values outside [0,1] range for stronger depth effects
          const composerRT1 = new THREE.WebGLRenderTarget(pSize, pSize, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
          })
          const composerRT2 = composerRT1.clone()
          let writeBuffer = composerRT1
          let readBuffer = composerRT2

          const rtFinal = new THREE.WebGLRenderTarget(mSize, mSize, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            generateMipmaps: false,
            depthBuffer: false,
            stencilBuffer: false,
          })

          // ── PASS 0: BUFFER ────────────────────────────────────
          renderer.setRenderTarget(rtBuffer)
          renderer.setClearColor(0x000000, 0)
          renderer.clear(true, true, true)
          renderer.render(modelScene, modelCamera)
          {
            const px = readRT(renderer, rtBuffer)
            passes.push({ name: 'buffer', pixels: Array.from(px), width: mSize, height: mSize, stats: computeStats(px, mSize, mSize) })
          }

          // ── PASS 1: EMBROIDERY PATTERN ────────────────────────
          {
            const mat = new THREE.ShaderMaterial({
              uniforms: {
                userLayer: { value: rtBuffer.texture },
                pSize: new THREE.Uniform(new THREE.Vector2(1.0 / mSize, 1.0 / mSize)),
                threadThickness: new THREE.Uniform(emb.threadThickness),
                threadDensity: new THREE.Uniform(emb.threadDensity),
                threadLength: new THREE.Uniform(emb.threadLength),
                threadOffset: new THREE.Uniform(emb.threadOffset),
                threadScale: new THREE.Uniform(emb.threadScale),
              },
              vertexShader: shaders.modelVertexShader,
              fragmentShader: shaders.embroideryPatternFragmentShader,
            })
            const mesh = new THREE.Mesh(fsGeometry, mat)
            const scene = new THREE.Scene()
            scene.add(mesh)
            renderer.setRenderTarget(rtEmbroidery)
            renderer.setClearColor(0x000000, 0)
            renderer.clear(true, true, true)
            renderer.render(scene, fsCamera)
            const px = readRT(renderer, rtEmbroidery)
            passes.push({ name: 'embroidery', pixels: Array.from(px), width: mSize, height: mSize, stats: computeStats(px, mSize, mSize) })
            scene.remove(mesh); mat.dispose()
          }

          // ── PASS 2-3: EffectComposer PING-PONG ───────────────

          // Step A: "RenderPass" — render model scene to readBuffer (not writeBuffer!)
          // Three.js RenderPass.render() calls renderer.setRenderTarget(readBuffer)
          // with needsSwap=false, so no swap after.
          renderer.setRenderTarget(readBuffer)
          renderer.setClearColor(0x000000, 0)
          renderer.clear(true, true, true)
          renderer.render(modelScene, modelCamera)

          // Step B: "SobelPass" — reads readBuffer (scene data), writes writeBuffer, swap
          {
            const mat = new THREE.ShaderMaterial({
              uniforms: {
                tDiffuse: { value: readBuffer.texture },
                pixelSize: new THREE.Uniform(new THREE.Vector2(1.0 / pSize, 1.0 / pSize)),
                edge: new THREE.Uniform(false),
                both: new THREE.Uniform(true),
                power: new THREE.Uniform(emb.sobelPower),
              },
              vertexShader: shaders.modelVertexShader,
              fragmentShader: shaders.fxSobelFragmentShader,
            })
            const mesh = new THREE.Mesh(fsGeometry, mat)
            const scene = new THREE.Scene()
            scene.add(mesh)
            renderer.setRenderTarget(writeBuffer)
            renderer.render(scene, fsCamera)
            ;[writeBuffer, readBuffer] = [readBuffer, writeBuffer]
            scene.remove(mesh); mat.dispose()
          }

          // Capture sobel (HalfFloat RT → clamp to Uint8Array for comparison)
          {
            const px = readHalfFloatRT(renderer, readBuffer)
            passes.push({ name: 'sobel', pixels: Array.from(px), width: pSize, height: pSize, stats: computeStats(px, pSize, pSize) })
          }

          // Step C: "BlurPass" — reads readBuffer, writes writeBuffer, swap
          {
            const mat = new THREE.ShaderMaterial({
              uniforms: {
                tDiffuse: { value: readBuffer.texture },
                blur: { value: emb.blur },
              },
              vertexShader: shaders.modelVertexShader,
              fragmentShader: shaders.fxBlurFragmentShader,
            })
            const mesh = new THREE.Mesh(fsGeometry, mat)
            const scene = new THREE.Scene()
            scene.add(mesh)
            renderer.setRenderTarget(writeBuffer)
            renderer.render(scene, fsCamera)
            ;[writeBuffer, readBuffer] = [readBuffer, writeBuffer]
            scene.remove(mesh); mat.dispose()
          }

          // Capture blur (HalfFloat RT → clamp to Uint8Array for comparison)
          {
            const px = readHalfFloatRT(renderer, readBuffer)
            passes.push({ name: 'blur', pixels: Array.from(px), width: pSize, height: pSize, stats: computeStats(px, pSize, pSize) })
          }

          // processedLayer = readBuffer.texture

          // ── PASS 4: BASE+BLEND COMPOSITION ────────────────────
          {
            const whitePixels = new Uint8Array([255, 255, 255, 255])
            const whiteTex = new THREE.DataTexture(whitePixels, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
            whiteTex.needsUpdate = true
            const blackPixels = new Uint8Array([0, 0, 0, 0])
            const blackTex = new THREE.DataTexture(blackPixels, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
            blackTex.needsUpdate = true

            const sharedUniforms: any = {
              pixelSize: new THREE.Uniform(new THREE.Vector2(1.0 / mSize, 1.0 / mSize)),
              color: new THREE.Uniform(new THREE.Color(0xffffff)),
              secondaryColor: new THREE.Uniform(new THREE.Color(0x808080)),
              secondarySaturation: new THREE.Uniform(0.5),
              secondaryBrightness: new THREE.Uniform(0.0),
              secondaryContrast: new THREE.Uniform(1.0),
              secondaryGamma: new THREE.Uniform(1.0),
              isBgTransparent: new THREE.Uniform(false),
              maskBlurStrength: new THREE.Uniform(1.0),
              maskErosionStart: new THREE.Uniform(0.7),
              maskErosionEnd: new THREE.Uniform(1.0),
              isMulticolor: new THREE.Uniform(false),
              layerUsed: new THREE.Uniform(0),
              hl: new THREE.Uniform(0.5),
              hr: new THREE.Uniform(0.5),
              sa: new THREE.Uniform(1.0),
              sh: new THREE.Uniform(0.001),
              cv: new THREE.Uniform(1.0),
              bv: new THREE.Uniform(0.0),
              gv: new THREE.Uniform(1.0),
              mixValue: new THREE.Uniform(1.0),
              baseLayer: new THREE.Uniform(whiteTex),
              maskLayer: new THREE.Uniform(whiteTex),
              optionalLayer: new THREE.Uniform(blackTex),
              userLayer: new THREE.Uniform(rtBuffer.texture),
              embLayer: new THREE.Uniform(rtEmbroidery.texture),
              processedLayer: new THREE.Uniform(readBuffer.texture),
              isHeather: new THREE.Uniform(false),
              textureAmount: new THREE.Uniform(1.0),
              heatherScale: new THREE.Uniform(2.0),
              heatherAngle: new THREE.Uniform(0.0),
              heatherTexture: new THREE.Uniform(whiteTex),
            }

            const compositeCamera = new THREE.OrthographicCamera(
              mSize / -2, mSize / 2, mSize / 2, mSize / -2, 1, 10000,
            )
            compositeCamera.position.z = 1

            const compositeScene = new THREE.Scene()
            const planeGeo = new THREE.PlaneGeometry(mSize, mSize, 1, 1)

            const baseMat = new THREE.ShaderMaterial({
              uniforms: sharedUniforms,
              vertexShader: shaders.basicVertexShader,
              fragmentShader: shaders.embroideryShaderBase,
              glslVersion: THREE.GLSL1,
              transparent: false,
            })
            baseMat.needsUpdate = true
            const basePlane = new THREE.Mesh(planeGeo, baseMat)
            basePlane.position.set(0, 0, -100.0)
            compositeScene.add(basePlane)

            const blendMat = new THREE.ShaderMaterial({
              uniforms: sharedUniforms,
              vertexShader: shaders.basicVertexShader,
              fragmentShader: shaders.embroideryShaderBlend,
              glslVersion: THREE.GLSL1,
              transparent: true,
              premultipliedAlpha: false,
              blending: THREE.CustomBlending,
              blendEquation: THREE.AddEquation,
              blendSrc: THREE.DstAlphaFactor,
              blendDst: THREE.OneMinusSrcAlphaFactor,
              blendSrcAlpha: THREE.SrcAlphaFactor,
              blendDstAlpha: THREE.OneFactor,
            })
            blendMat.needsUpdate = true
            const blendPlane = new THREE.Mesh(planeGeo, blendMat)
            blendPlane.position.set(0, 0, -50.0)
            compositeScene.add(blendPlane)

            renderer.setRenderTarget(rtFinal)
            renderer.setClearColor(0x000000, 0)
            renderer.clear(true, true, true)
            renderer.render(compositeScene, compositeCamera)

            const px = readRT(renderer, rtFinal)
            passes.push({ name: 'final', pixels: Array.from(px), width: mSize, height: mSize, stats: computeStats(px, mSize, mSize) })

            baseMat.dispose(); blendMat.dispose()
            planeGeo.dispose(); whiteTex.dispose(); blackTex.dispose()
          }

          // Cleanup
          rtBuffer.dispose(); rtEmbroidery.dispose()
          composerRT1.dispose(); composerRT2.dispose()
          rtFinal.dispose(); fsGeometry.dispose()
          renderer.dispose()

          return { passes }
        })()
      },
      SHADERS,
      artworkBase64,
      mainSize,
      procSize,
      bufferSamples,
      embroidery,
    )

    const passes: PassResult[] = result.passes.map((p: any) => ({
      ...p,
      pixels: new Uint8Array(p.pixels),
    }))

    for (const pass of passes) {
      console.log(`[Puppeteer] ${pass.name}: nonZero=${pass.stats.nonZeroPixels}/${pass.stats.totalPixels}, alpha=[${pass.stats.minA},${pass.stats.maxA}]`)
    }

    return { passes }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}
