/**
 * Diagnostic script: check HeadlessRenderer state at each step
 * Run: cd packages/renderer-server && npx tsx src/__tests__/diagnose-render.ts
 */
import { HeadlessRenderer } from '../rendering/HeadlessRenderer.js'
import { readFileSync } from 'fs'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createCanvas, Image } from 'canvas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const FIXTURES_DIR = join(__dirname, '__fixtures__')

function checkRT(renderer: any, rt: any, label: string) {
  if (!rt) { console.log(`  ${label}: NULL`); return }
  const w = rt.width, h = rt.height
  const px = new Uint8Array(w * h * 4)
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px)
  let nonZero = 0
  for (let i = 0; i < px.length; i++) if (px[i] > 0) nonZero++
  const pct = (nonZero / px.length * 100).toFixed(1)
  console.log(`  ${label}: ${w}x${h}, nonZero=${nonZero}/${px.length} (${pct}%)`)
}

function tryCompileShader(gl: any, type: number, source: string, label: string) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
  if (!success) {
    console.log(`  ❌ ${label} COMPILE FAILED: ${gl.getShaderInfoLog(shader)}`)
  } else {
    console.log(`  ✅ ${label} compiled OK`)
  }
  gl.deleteShader(shader)
  return success
}

async function diagnose() {
  const renderer = new HeadlessRenderer(2048)
  const generatorData = JSON.parse(readFileSync(join(FIXTURES_DIR, 'embroidery-generator.json'), 'utf-8'))
  const artworkBase64 = readFileSync(join(FIXTURES_DIR, 'test-artwork.png')).toString('base64')

  await renderer.initialize([])
  await renderer.addGenerator(generatorData)

  const prv2 = (renderer as any).renderer
  const gl = (renderer as any).glContext

  const activeGen = prv2.state?.activeGenerator

  // Check shaders
  const { shaders } = await import('@fourthwall/product-renderer/dist/shaders/index.js')
  console.log('\n=== SHADER COMPILATION TEST ===')
  tryCompileShader(gl, gl.VERTEX_SHADER, shaders.modelVertexShader, 'modelVertexShader')
  tryCompileShader(gl, gl.FRAGMENT_SHADER, shaders.modelFragmentShader, 'modelFragmentShader')
  tryCompileShader(gl, gl.VERTEX_SHADER, shaders.basicVertexShader, 'basicVertexShader')
  tryCompileShader(gl, gl.FRAGMENT_SHADER, shaders.embroideryFragmentShaderBlend, 'embroideryFragmentShaderBlend')

  // But Three.js adds prefix code to shaders. Let me check what the actual shader looks like
  // after Three.js processing. For that, let me check the renderer's info.
  console.log('\n=== THREE.JS RENDERER INFO ===')
  console.log('Programs count:', prv2._renderer?.info?.programs?.length || 0)
  const programs = prv2._renderer?.info?.programs || []
  programs.forEach((p: any, i: number) => {
    console.log(`  program[${i}]: name=${p.name}, usedTimes=${p.usedTimes}`)
  })

  // Upload artwork
  console.log('\n=== UPLOAD ARTWORK & RENDER ===')
  const img = new Image()
  img.src = Buffer.from(artworkBase64, 'base64')
  const artCanvas = createCanvas(img.width, img.height)
  const ctx = artCanvas.getContext('2d')
  ctx.drawImage(img as any, 0, 0)
  prv2.regionCanvasToActiveGeneratorTexture(artCanvas as any, generatorData.regions[0].id)

  prv2.switchView('Packshot Front')

  // Enable shader errors before rendering
  prv2._renderer.debug.checkShaderErrors = true

  // Try rendering just one visible mesh
  const bufferChildren = activeGen.scenes.buffer.children
  const visibleMeshes = bufferChildren.filter((c: any) => c.visible)
  console.log(`Visible buffer meshes: ${visibleMeshes.length}`)

  // Check the first visible mesh's geometry
  if (visibleMeshes.length > 0) {
    const mesh = visibleMeshes[0]
    const geom = mesh.geometry
    console.log(`  Mesh[0] geometry attributes:`, Object.keys(geom?.attributes || {}))
    console.log(`  Mesh[0] index:`, geom?.index ? `${geom.index.count} indices` : 'null')
    console.log(`  Mesh[0] position count:`, geom?.attributes?.position?.count || 0)
    console.log(`  Mesh[0] uv count:`, geom?.attributes?.uv?.count || 0)
    console.log(`  Mesh[0] boundingSphere:`, geom?.boundingSphere)
    console.log(`  Mesh[0] drawRange:`, geom?.drawRange)
    console.log(`  Mesh[0] frustumCulled:`, mesh.frustumCulled)
    console.log(`  Mesh[0] material.visible:`, mesh.material?.visible)
    console.log(`  Mesh[0] material.side:`, mesh.material?.side)
    console.log(`  Mesh[0] material.transparent:`, mesh.material?.transparent)
    // Check world position
    mesh.updateWorldMatrix(true, false)
    const worldPos = mesh.getWorldPosition(new (await import('three')).Vector3())
    console.log(`  Mesh[0] world position:`, worldPos)
  }

  // Now do the full render
  console.log('\n--- Full render ---')
  prv2._renderer.setRenderTarget(prv2.textures.buffer)
  prv2._renderer.clear(true, true, true)

  try {
    prv2._renderer.render(activeGen.scenes.buffer, prv2.cameras.model)
  } catch (e: any) {
    console.log('RENDER ERROR:', e.message)
    console.log(e.stack?.split('\n').slice(0, 5).join('\n'))
  }
  checkRT(prv2._renderer, prv2.textures.buffer, 'textures.buffer')

  // Check programs again after render
  console.log('Programs count after render:', prv2._renderer?.info?.programs?.length || 0)
  const progs2 = prv2._renderer?.info?.programs || []
  progs2.forEach((p: any, i: number) => {
    console.log(`  program[${i}]: name=${p.name}, usedTimes=${p.usedTimes}`)
  })

  // Check properties cache
  const matProps = (prv2._renderer as any).properties?.get(visibleMeshes[0]?.material)
  console.log('Material properties:', matProps ? Object.keys(matProps) : 'none')
  if (matProps?.program) {
    console.log('  Program exists in properties!')
    console.log('  Program diagnostics:', matProps.program.diagnostics)
  }
  if (matProps?.currentProgram) {
    console.log('  currentProgram exists in properties!')
  }

  // Try the bulkDraw flow
  console.log('\n=== BULK DRAW TEST ===')
  try {
    prv2.switchView('Packshot Front')
    activeGen.updateRegionUniforms()
    prv2.drawBuffer()
    checkRT(prv2._renderer, prv2.textures.buffer, 'textures.buffer after drawBuffer')

    // Render to default FB
    prv2._renderer.setRenderTarget(null)
    prv2._renderer.clear(true, true, true)
    prv2._renderer.render(activeGen.scenes.default, prv2.cameras.default)

    const viewport = gl.getParameter(gl.VIEWPORT)
    const fbW = viewport[2], fbH = viewport[3]
    const fbPx = new Uint8Array(fbW * fbH * 4)
    gl.readPixels(0, 0, fbW, fbH, gl.RGBA, gl.UNSIGNED_BYTE, fbPx)
    let fbNonZero = 0
    for (let i = 0; i < fbPx.length; i++) if (fbPx[i] > 0) fbNonZero++
    console.log(`Default FB: ${fbW}x${fbH}, nonZero=${fbNonZero}/${fbPx.length} (${(fbNonZero / fbPx.length * 100).toFixed(1)}%)`)

    // Save the framebuffer to a PNG file
    const tempCanvas = createCanvas(fbW, fbH)
    const tCtx = tempCanvas.getContext('2d')
    const imgData = tCtx.createImageData(fbW, fbH)
    const rowSize = fbW * 4
    for (let y = 0; y < fbH; y++) {
      const srcRow = y * rowSize
      const dstRow = (fbH - 1 - y) * rowSize
      imgData.data.set(fbPx.subarray(srcRow, srcRow + rowSize), dstRow)
    }
    tCtx.putImageData(imgData, 0, 0)
    const pngBuf = tempCanvas.toBuffer('image/png')
    const outPath = join(__dirname, '__diffs__', 'diagnose-output.png')
    writeFileSync(outPath, pngBuf)
    console.log(`Saved output: ${outPath} (${pngBuf.length} bytes)`)
  } catch(e: any) {
    console.log('Bulk draw error:', e.message)
  }

  try { renderer.dispose() } catch(e) {}
}

diagnose().catch(console.error)
