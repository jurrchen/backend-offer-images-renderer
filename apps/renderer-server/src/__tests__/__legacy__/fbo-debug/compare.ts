/**
 * Compare — pass-by-pass comparison of two pipeline results
 *
 * Uses pixelmatch (already in devDeps) to compare each pass from
 * headless-gl vs Puppeteer. Generates diff images and reports which
 * pass first diverges → that's where the FBO bug manifests.
 */

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { PipelineResult, PassResult } from './fbo-pipeline.js'

const __dirname_local = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = join(__dirname_local, '../__diffs__/fbo-debug')

export interface PassComparison {
  name: string
  width: number
  height: number
  diffPixels: number
  totalPixels: number
  diffPercent: number
  match: boolean
  /** true if one or both sides have zero non-zero pixels (i.e. empty) */
  aIsEmpty: boolean
  bIsEmpty: boolean
}

export interface ComparisonResult {
  passes: PassComparison[]
  /** Name of the first pass that differs, or null if all match */
  firstDivergentPass: string | null
  /** Summary string for logging */
  summary: string
}

// ── Helpers ─────────────────────────────────────────────────────────────

function pixelsToPNG(pixels: Uint8Array, width: number, height: number): PNG {
  const png = new PNG({ width, height })
  png.data = Buffer.from(pixels)
  return png
}

function savePNG(pixels: Uint8Array, width: number, height: number, filepath: string): void {
  const png = pixelsToPNG(pixels, width, height)
  writeFileSync(filepath, PNG.sync.write(png))
}

// ── Main Comparison ─────────────────────────────────────────────────────

export function comparePipelines(
  a: PipelineResult,
  b: PipelineResult,
  opts: {
    /** Per-pixel colour threshold for pixelmatch (0-1). Default: 0.1 */
    pixelThreshold?: number
    /** Percentage of different pixels to consider a pass "matching". Default: 1.0 (%) */
    matchThreshold?: number
    /** Save intermediate PNGs + diffs? Default: true */
    saveToDisk?: boolean
    /** Output directory. Default: __diffs__/fbo-debug/ */
    outputDir?: string
  } = {},
): ComparisonResult {
  const pixelThreshold = opts.pixelThreshold ?? 0.1
  const matchThreshold = opts.matchThreshold ?? 1.0
  const saveToDisk = opts.saveToDisk ?? true
  const outputDir = opts.outputDir ?? OUTPUT_DIR

  if (saveToDisk && !existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const passComparisons: PassComparison[] = []
  let firstDivergentPass: string | null = null

  // Compare pass-by-pass (use the shorter list length)
  const len = Math.min(a.passes.length, b.passes.length)

  for (let i = 0; i < len; i++) {
    const pa = a.passes[i]
    const pb = b.passes[i]
    const name = pa.name

    // Size must match
    if (pa.width !== pb.width || pa.height !== pb.height) {
      console.warn(`[compare] Pass "${name}" size mismatch: ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`)
      passComparisons.push({
        name,
        width: pa.width,
        height: pb.height,
        diffPixels: -1,
        totalPixels: -1,
        diffPercent: 100,
        match: false,
        aIsEmpty: pa.stats.nonZeroPixels === 0,
        bIsEmpty: pb.stats.nonZeroPixels === 0,
      })
      if (!firstDivergentPass) firstDivergentPass = name
      continue
    }

    const { width, height } = pa
    const totalPixels = width * height

    // Run pixelmatch
    const diff = new PNG({ width, height })
    const diffPixels = pixelmatch(
      pa.pixels,
      pb.pixels,
      diff.data,
      width,
      height,
      {
        threshold: pixelThreshold,
        alpha: 0.1,
        includeAA: true,
      },
    )

    const diffPercent = (diffPixels / totalPixels) * 100
    const match = diffPercent <= matchThreshold

    passComparisons.push({
      name,
      width,
      height,
      diffPixels,
      totalPixels,
      diffPercent,
      match,
      aIsEmpty: pa.stats.nonZeroPixels === 0,
      bIsEmpty: pb.stats.nonZeroPixels === 0,
    })

    if (!match && !firstDivergentPass) {
      firstDivergentPass = name
    }

    // Save PNGs
    if (saveToDisk) {
      savePNG(pa.pixels, width, height, join(outputDir, `${name}_a_puppeteer.png`))
      savePNG(pb.pixels, width, height, join(outputDir, `${name}_b_headless.png`))
      writeFileSync(join(outputDir, `${name}_diff.png`), PNG.sync.write(diff))
    }
  }

  // Build summary
  const lines = ['FBO Debug — Pass-by-Pass Comparison', '=' .repeat(50)]
  for (const pc of passComparisons) {
    const status = pc.match ? 'MATCH' : 'DIFF'
    const emptyNote = (pc.aIsEmpty ? ' [A empty]' : '') + (pc.bIsEmpty ? ' [B empty]' : '')
    lines.push(
      `  ${status.padEnd(5)} ${pc.name.padEnd(12)} ${pc.diffPercent.toFixed(2)}% different (${pc.diffPixels}/${pc.totalPixels} px)${emptyNote}`,
    )
  }
  if (firstDivergentPass) {
    lines.push('', `FIRST DIVERGENCE at pass: "${firstDivergentPass}"`)
  } else {
    lines.push('', 'All passes match within threshold!')
  }
  const summary = lines.join('\n')

  return { passes: passComparisons, firstDivergentPass, summary }
}
