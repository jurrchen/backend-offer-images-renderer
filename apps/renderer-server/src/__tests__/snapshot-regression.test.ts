/**
 * Snapshot Regression Test — all production methods
 *
 * Renders one image per fixture JSON (DTG, SUBLIMATION, EMBROIDERY, UV, etc.)
 * and compares against stored baselines using pixelmatch.
 *
 * First run: generates baselines automatically.
 * Subsequent runs: compares against baselines with configurable threshold.
 *
 * Usage:
 *   npx vitest run src/__tests__/snapshot-regression.test.ts          # compare
 *   UPDATE_SNAPSHOTS=1 npx vitest run src/__tests__/snapshot-regression.test.ts  # regenerate baselines
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { HeadlessRenderer } from '../rendering/HeadlessRenderer.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { compareImages } from './utils/image-compare.js'

// ── Paths ───────────────────────────────────────────────────────────────────
const ROOT_DIR = resolve(import.meta.dirname, '../..')
const FIXTURES_DIR = join(ROOT_DIR, 'fixtures')
const ARTWORK_PATH = join(import.meta.dirname, '__fixtures__/test-artwork.png')
const SNAPSHOTS_DIR = join(import.meta.dirname, '__snapshots__/regression')
const DIFFS_DIR = join(import.meta.dirname, '__diffs__/snapshot')

// ── Env flags ───────────────────────────────────────────────────────────────
const UPDATE_SNAPSHOTS = !!process.env.UPDATE_SNAPSHOTS

// ── Per-method thresholds (% pixel diff allowed) ────────────────────────────
// EMBROIDERY may need higher tolerance due to pseudorandom hash-based stitching
const THRESHOLDS: Record<string, number> = {
  DTG: 0.5,
  SUBLIMATION: 0.5,
  EMBROIDERY: 1.0,
  UV: 0.5,
  ALL_OVER_PRINT: 0.5,
  PRINTED: 0.5,
  KNITTED: 0.5,
}
const DEFAULT_THRESHOLD = 0.5

// ── Fixture definitions ─────────────────────────────────────────────────────
const FIXTURES = [
  'DTG',
  'SUBLIMATION',
  'EMBROIDERY',
  'UV',
  'ALL_OVER_PRINT',
  'PRINTED',
  'KNITTED',
] as const

type FixtureName = typeof FIXTURES[number]

// ── Shared renderer (singleton — headless-gl SEGFAULT on multiple contexts) ─
let renderer: HeadlessRenderer

describe('Snapshot Regression', () => {
  beforeAll(async () => {
    // Ensure output directories exist
    mkdirSync(SNAPSHOTS_DIR, { recursive: true })
    mkdirSync(DIFFS_DIR, { recursive: true })

    // Initialize shared renderer (dynamic mode — 0 generators, add on demand)
    renderer = new HeadlessRenderer(2048)
    await renderer.initialize([])
  }, 60_000)

  afterAll(() => {
    renderer?.dispose()
  })

  for (const fixtureName of FIXTURES) {
    it(`${fixtureName} — renders and matches baseline`, async () => {
      const fixturePath = join(FIXTURES_DIR, `${fixtureName}.json`)
      if (!existsSync(fixturePath)) {
        throw new Error(`Fixture not found: ${fixturePath}`)
      }

      // 1. Load generator from fixture
      const generatorData = JSON.parse(readFileSync(fixturePath, 'utf-8'))
      await renderer.addGenerator(generatorData)

      // 2. Load artwork
      const artworkBuffer = readFileSync(ARTWORK_PATH)
      const artworkBase64 = artworkBuffer.toString('base64')

      // 3. Pick first region, color, view
      const generatorId = generatorData.id
      const regionId = generatorData.regions[0].id
      const colorName = generatorData.colors[0].name
      const viewName = generatorData.views[0].name

      console.log(`\n📸 ${fixtureName}: generator=${generatorId}, region=${regionId}, color=${colorName}, view=${viewName}`)

      // 4. Render
      renderer.setTransparentBackground(true)
      const results = await renderer.renderBatch({
        generatorId,
        images: [{ region: regionId, data: artworkBase64 }],
        colors: [colorName],
        views: [viewName],
        renderSize: 2048,
        generatorData,
      })

      expect(results.length).toBeGreaterThanOrEqual(1)
      // Take first result — some generators have duplicate view names
      const renderedBuffer = results[0].buffer

      // 5. Always save actual output for inspection
      const actualPath = join(DIFFS_DIR, `${fixtureName}_actual.png`)
      writeFileSync(actualPath, renderedBuffer)

      // 6. Baseline handling
      const baselinePath = join(SNAPSHOTS_DIR, `${fixtureName}.png`)

      if (UPDATE_SNAPSHOTS || !existsSync(baselinePath)) {
        // Save new baseline
        writeFileSync(baselinePath, renderedBuffer)
        const action = UPDATE_SNAPSHOTS ? 'Updated' : 'Created new'
        console.log(`  ✅ ${action} baseline: ${baselinePath}`)
        return // Test passes — baseline was just written
      }

      // 7. Compare against existing baseline
      const baselineBuffer = readFileSync(baselinePath)
      const threshold = THRESHOLDS[fixtureName] ?? DEFAULT_THRESHOLD
      const comparison = compareImages(renderedBuffer, baselineBuffer, threshold)

      // 8. Save diff image if comparison generated one
      if (comparison.diffImage) {
        const diffPath = join(DIFFS_DIR, `${fixtureName}_diff.png`)
        writeFileSync(diffPath, comparison.diffImage)
      }

      // 9. Report results
      if (!comparison.match) {
        if (comparison.sizeMismatch) {
          console.log(`  ❌ ${fixtureName} — SIZE MISMATCH!`)
          console.log(`     Actual:   ${comparison.actualSize?.width}x${comparison.actualSize?.height}`)
          console.log(`     Expected: ${comparison.expectedSize?.width}x${comparison.expectedSize?.height}`)
        } else {
          console.log(`  ❌ ${fixtureName} — ${comparison.diffPercent.toFixed(2)}% pixels differ (threshold: ${threshold}%)`)
        }
      } else {
        console.log(`  ✅ ${fixtureName} — ${comparison.diffPercent.toFixed(2)}% diff (threshold: ${threshold}%)`)
      }

      expect(comparison.sizeMismatch).toBeFalsy()
      expect(comparison.match).toBe(true)
      expect(comparison.diffPercent).toBeLessThanOrEqual(threshold)
    }, 60_000) // 60s timeout per fixture (asset loading can be slow)
  }
})
