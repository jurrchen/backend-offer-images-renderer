/**
 * Region Switching Test — verifies texture state doesn't leak between renders
 *
 * Bug: When rendering a product with artwork on region A, then re-rendering
 * the same product with artwork on only region B (or no artwork), region A's
 * texture persists — both regions show textures even though only region B
 * was specified in the second render call.
 *
 * Usage:
 *   npx vitest run src/__tests__/region-switching.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { HeadlessRenderer } from '../rendering/HeadlessRenderer.js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { compareImages } from './utils/image-compare.js'

// ── Paths ───────────────────────────────────────────────────────────────────
const ROOT_DIR = resolve(import.meta.dirname, '../..')
const FIXTURES_DIR = join(ROOT_DIR, 'fixtures')
const ARTWORK_PATH = join(import.meta.dirname, '__fixtures__/test-artwork.png')
const DIFFS_DIR = join(import.meta.dirname, '__diffs__/region-switching')

// ── Shared renderer (singleton — headless-gl SEGFAULT on multiple contexts) ─
let renderer: HeadlessRenderer

describe('Region Switching — texture state isolation', () => {
  beforeAll(async () => {
    mkdirSync(DIFFS_DIR, { recursive: true })
    renderer = new HeadlessRenderer(2048)
    await renderer.initialize([])
  }, 60_000)

  afterAll(() => {
    renderer?.dispose()
  })

  it('region texture does not persist when re-rendering with no images', async () => {
    // Load DTG fixture (single-region: "front")
    const fixturePath = join(FIXTURES_DIR, 'DTG.json')
    const generatorData = JSON.parse(readFileSync(fixturePath, 'utf-8'))
    await renderer.addGenerator(generatorData)

    const generatorId = generatorData.id
    const regionId = generatorData.regions[0].id
    const colorName = generatorData.colors[0].name
    const viewName = generatorData.views[0].name
    const artworkBase64 = readFileSync(ARTWORK_PATH).toString('base64')

    renderer.setTransparentBackground(true)

    // Step 1: Render clean — no artwork (baseline)
    const cleanResults = await renderer.renderBatch({
      generatorId,
      images: [],
      colors: [colorName],
      views: [viewName],
      renderSize: 2048,
      generatorData,
    })
    const cleanBuffer = cleanResults[0].buffer
    writeFileSync(join(DIFFS_DIR, '01_clean.png'), cleanBuffer)

    // Step 2: Render WITH artwork on region "front"
    const artworkResults = await renderer.renderBatch({
      generatorId,
      images: [{ region: regionId, data: artworkBase64 }],
      colors: [colorName],
      views: [viewName],
      renderSize: 2048,
      generatorData,
    })
    const artworkBuffer = artworkResults[0].buffer
    writeFileSync(join(DIFFS_DIR, '02_with_artwork.png'), artworkBuffer)

    // Sanity check: artwork render should differ from clean
    // Threshold is 0.3% because the artwork is small relative to the 2048x2048 canvas
    const artworkVsClean = compareImages(artworkBuffer, cleanBuffer, 50)
    console.log(`  Artwork vs Clean: ${artworkVsClean.diffPercent.toFixed(2)}% diff`)
    expect(artworkVsClean.diffPercent).toBeGreaterThan(0.3)

    // Step 3: Re-render with NO images (region "front" should be cleared)
    const afterResults = await renderer.renderBatch({
      generatorId,
      images: [],
      colors: [colorName],
      views: [viewName],
      renderSize: 2048,
      generatorData,
    })
    const afterBuffer = afterResults[0].buffer
    writeFileSync(join(DIFFS_DIR, '03_after_no_images.png'), afterBuffer)

    // Step 4: Compare — after-render should match clean baseline
    const comparison = compareImages(afterBuffer, cleanBuffer, 0.5)
    if (comparison.diffImage) {
      writeFileSync(join(DIFFS_DIR, '03_vs_clean_diff.png'), comparison.diffImage)
    }
    console.log(`  After (no images) vs Clean: ${comparison.diffPercent.toFixed(2)}% diff`)

    // If texture leaked, afterBuffer still shows artwork → high diff vs clean
    expect(comparison.match).toBe(true)
    expect(comparison.diffPercent).toBeLessThanOrEqual(0.5)
  }, 120_000)

  it('region A texture does not persist when re-rendering with artwork on region B only', async () => {
    // Load DTG fixture — the view references multiple regions:
    // ["sleeve_right", "sleeve_left", "label_inside", "front_large", "front"]
    // We use "front" as region A and "front_large" as region B
    const fixturePath = join(FIXTURES_DIR, 'DTG.json')
    const generatorData = JSON.parse(readFileSync(fixturePath, 'utf-8'))
    await renderer.addGenerator(generatorData)

    const generatorId = generatorData.id
    const regionA = generatorData.regions[0].id // "front"
    const regionB = 'front_large' // Referenced in view but separate from region A
    const colorName = generatorData.colors[0].name
    const viewName = generatorData.views[0].name
    const artworkBase64 = readFileSync(ARTWORK_PATH).toString('base64')

    renderer.setTransparentBackground(true)

    // Step 1: Render clean — no artwork (baseline)
    const cleanResults = await renderer.renderBatch({
      generatorId,
      images: [],
      colors: [colorName],
      views: [viewName],
      renderSize: 2048,
      generatorData,
    })
    const cleanBuffer = cleanResults[0].buffer
    writeFileSync(join(DIFFS_DIR, '04_regionAB_clean.png'), cleanBuffer)

    // Step 2: Render with artwork on region A ("front")
    const regionAResults = await renderer.renderBatch({
      generatorId,
      images: [{ region: regionA, data: artworkBase64 }],
      colors: [colorName],
      views: [viewName],
      renderSize: 2048,
      generatorData,
    })
    const regionABuffer = regionAResults[0].buffer
    writeFileSync(join(DIFFS_DIR, '05_regionA_artwork.png'), regionABuffer)

    // Sanity check: region A artwork should be visible
    // Threshold is 0.3% because the artwork is small relative to the 2048x2048 canvas
    const regionAvsClean = compareImages(regionABuffer, cleanBuffer, 50)
    console.log(`  Region A artwork vs Clean: ${regionAvsClean.diffPercent.toFixed(2)}% diff`)
    expect(regionAvsClean.diffPercent).toBeGreaterThan(0.3)

    // Step 3: Re-render with artwork on region B ONLY ("front_large")
    // Region A ("front") should NOT retain artwork from step 2
    const regionBResults = await renderer.renderBatch({
      generatorId,
      images: [{ region: regionB, data: artworkBase64 }],
      colors: [colorName],
      views: [viewName],
      renderSize: 2048,
      generatorData,
    })
    const regionBBuffer = regionBResults[0].buffer
    writeFileSync(join(DIFFS_DIR, '06_regionB_only.png'), regionBBuffer)

    // Step 4: Compare region B render vs region A render
    // If region A leaked, the region B render would look like BOTH regions have artwork
    // (similar to region A render). They should differ significantly.
    const regionBvsA = compareImages(regionBBuffer, regionABuffer, 50)
    if (regionBvsA.diffImage) {
      writeFileSync(join(DIFFS_DIR, '06_regionB_vs_regionA_diff.png'), regionBvsA.diffImage)
    }
    console.log(`  Region B only vs Region A: ${regionBvsA.diffPercent.toFixed(2)}% diff`)

    // The region B render should NOT look identical to region A render
    // (if they're nearly identical, region A texture leaked into region B render)
    expect(regionBvsA.diffPercent).toBeGreaterThan(0.5)
  }, 120_000)
})
