/**
 * FBO Debug Test — headless-gl vs Puppeteer (Chrome)
 *
 * Runs the embroidery multi-pass pipeline through both backends
 * and compares each pass to identify exactly where headless-gl's
 * FBO texture sampling breaks.
 *
 * Run:
 *   cd packages/renderer-server
 *   npx vitest run src/__tests__/fbo-debug/fbo-debug.test.ts
 *
 * To run all variants (may require more memory):
 *   FBO_ALL_VARIANTS=1 npx vitest run src/__tests__/fbo-debug/fbo-debug.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { runPuppeteer } from './run-puppeteer.js'
import { runHeadlessGL, destroyHeadlessGL, type HeadlessGLVariant } from './run-headless-gl.js'
import { comparePipelines, type ComparisonResult } from './compare.js'
import type { PipelineResult, PipelineOptions } from './fbo-pipeline.js'

const __dirname_local = dirname(fileURLToPath(import.meta.url))
const DIFFS_DIR = join(__dirname_local, '../__diffs__/fbo-debug')

const PIPELINE_OPTS: PipelineOptions = {
  mainSize: 1024,
  processingSize: 512,
}

// 5% threshold — embroidery pattern has pseudorandom elements (hash-based)
// so slight GPU implementation differences may cause variation
const MATCH_THRESHOLD = 5.0

// Which variants to run. By default only direct + data-texture.
// Set env FBO_ALL_VARIANTS=1 to test all four.
const ALL_VARIANTS = !!process.env.FBO_ALL_VARIANTS
const VARIANTS_TO_TEST: HeadlessGLVariant[] = ALL_VARIANTS
  ? ['direct', 'data-texture', 'gl-finish', 'unbind-fbo']
  : ['direct', 'data-texture']

let puppeteerResult: PipelineResult
const headlessResults: Partial<Record<HeadlessGLVariant, PipelineResult>> = {}

describe('FBO Debug: headless-gl vs Puppeteer', () => {
  // ── Setup: run pipelines sequentially to avoid SEGFAULT ────────────

  beforeAll(async () => {
    console.log('\n--- Running Puppeteer (reference) pipeline ---')
    puppeteerResult = await runPuppeteer(PIPELINE_OPTS)

    for (const variant of VARIANTS_TO_TEST) {
      console.log(`\n--- Running headless-gl (${variant}) pipeline ---`)
      headlessResults[variant] = runHeadlessGL({ ...PIPELINE_OPTS, variant })
    }
  }, 120_000)

  afterAll(() => {
    destroyHeadlessGL()
  })

  // ── Sanity: Puppeteer produces non-empty output ────────────────────

  it('Puppeteer reference produces non-empty passes', () => {
    expect(puppeteerResult.passes).toHaveLength(5)
    for (const pass of puppeteerResult.passes) {
      expect(pass.stats.nonZeroPixels).toBeGreaterThan(0)
    }
  })

  // ── Direct variant (no workaround) ────────────────────────────────

  describe('Variant: direct (no workaround)', () => {
    let comparison: ComparisonResult

    beforeAll(() => {
      if (!headlessResults['direct']) return
      comparison = comparePipelines(puppeteerResult, headlessResults['direct']!, {
        matchThreshold: MATCH_THRESHOLD,
        outputDir: join(DIFFS_DIR, 'direct'),
      })
      console.log('\n' + comparison.summary)
    })

    it('Pass 0 (buffer) should match', () => {
      const p = comparison.passes.find(p => p.name === 'buffer')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })

    it('Pass 1 (embroidery pattern) should match', () => {
      const p = comparison.passes.find(p => p.name === 'embroidery')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })

    it('Pass 2 (sobel) should match', () => {
      const p = comparison.passes.find(p => p.name === 'sobel')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })

    it('Pass 3 (blur) should match', () => {
      const p = comparison.passes.find(p => p.name === 'blur')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })

    it('Pass 4 (final blend) should match', () => {
      const p = comparison.passes.find(p => p.name === 'final')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })
  })

  // ── Data-texture workaround variant ───────────────────────────────

  describe('Variant: data-texture (readPixels workaround)', () => {
    let comparison: ComparisonResult

    beforeAll(() => {
      if (!headlessResults['data-texture']) return
      comparison = comparePipelines(puppeteerResult, headlessResults['data-texture']!, {
        matchThreshold: MATCH_THRESHOLD,
        outputDir: join(DIFFS_DIR, 'data-texture'),
      })
      console.log('\n' + comparison.summary)
    })

    it('Pass 0 (buffer) should match', () => {
      const p = comparison.passes.find(p => p.name === 'buffer')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })

    it('Pass 1 (embroidery pattern) should match', () => {
      const p = comparison.passes.find(p => p.name === 'embroidery')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })

    it('Pass 2 (sobel) should match', () => {
      const p = comparison.passes.find(p => p.name === 'sobel')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })

    it('Pass 3 (blur) should match', () => {
      const p = comparison.passes.find(p => p.name === 'blur')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })

    it('Pass 4 (final blend) should match', () => {
      const p = comparison.passes.find(p => p.name === 'final')!
      expect(p.bIsEmpty).toBe(false)
      expect(p.diffPercent).toBeLessThanOrEqual(MATCH_THRESHOLD)
    })
  })

  // ── glFinish variant (only with FBO_ALL_VARIANTS) ─────────────────

  describe.skipIf(!ALL_VARIANTS)('Variant: gl-finish', () => {
    let comparison: ComparisonResult

    beforeAll(() => {
      if (!headlessResults['gl-finish']) return
      comparison = comparePipelines(puppeteerResult, headlessResults['gl-finish']!, {
        matchThreshold: MATCH_THRESHOLD,
      })
      console.log('\n' + comparison.summary)
    })

    it('Pass 0 (buffer) non-empty', () => {
      expect(comparison.passes.find(p => p.name === 'buffer')!.bIsEmpty).toBe(false)
    })

    it('Pass 1 (embroidery pattern) non-empty', () => {
      expect(comparison.passes.find(p => p.name === 'embroidery')!.bIsEmpty).toBe(false)
    })

    it('Pass 4 (final blend) non-empty', () => {
      expect(comparison.passes.find(p => p.name === 'final')!.bIsEmpty).toBe(false)
    })
  })

  // ── unbind-fbo variant (only with FBO_ALL_VARIANTS) ───────────────

  describe.skipIf(!ALL_VARIANTS)('Variant: unbind-fbo', () => {
    let comparison: ComparisonResult

    beforeAll(() => {
      if (!headlessResults['unbind-fbo']) return
      comparison = comparePipelines(puppeteerResult, headlessResults['unbind-fbo']!, {
        matchThreshold: MATCH_THRESHOLD,
      })
      console.log('\n' + comparison.summary)
    })

    it('Pass 0 (buffer) non-empty', () => {
      expect(comparison.passes.find(p => p.name === 'buffer')!.bIsEmpty).toBe(false)
    })

    it('Pass 1 (embroidery pattern) non-empty', () => {
      expect(comparison.passes.find(p => p.name === 'embroidery')!.bIsEmpty).toBe(false)
    })

    it('Pass 4 (final blend) non-empty', () => {
      expect(comparison.passes.find(p => p.name === 'final')!.bIsEmpty).toBe(false)
    })
  })

  // ── Summary ───────────────────────────────────────────────────────

  it('should log comparison summary for all variants', () => {
    console.log('\n' + '='.repeat(60))
    console.log('VARIANT COMPARISON SUMMARY')
    console.log('='.repeat(60))

    for (const [variant, result] of Object.entries(headlessResults)) {
      if (!result) continue
      const comp = comparePipelines(puppeteerResult, result, {
        matchThreshold: MATCH_THRESHOLD,
        saveToDisk: false,
      })
      const passNames = comp.passes.map(p => {
        const status = p.match ? 'OK' : 'FAIL'
        return `${p.name}:${status}(${p.diffPercent.toFixed(1)}%)`
      })
      console.log(`  ${variant.padEnd(15)} ${passNames.join(' | ')} ${comp.firstDivergentPass ? `[first diff: ${comp.firstDivergentPass}]` : '[all OK]'}`)
    }

    console.log('='.repeat(60))
    expect(true).toBe(true)
  })
})
