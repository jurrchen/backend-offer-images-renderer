import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { HeadlessRenderer } from '../rendering/HeadlessRenderer.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { compareImages } from './utils/image-compare.js'

// === KONFIGURACJA TESTU ===
const TEST_CONFIG = {
  generatorPath: join(__dirname, '__fixtures__/embroidery-generator.json'),
  baselinePath: join(__dirname, '__snapshots__/embroidery-baseline.png'),
  artworkPath: join(__dirname, '__fixtures__/test-artwork.png'),
  colorName: 'Black',      // <- do ustawienia przez użytkownika
  viewName: 'Packshot Front',      // <- do ustawienia przez użytkownika
  threshold: 0.5,           // 0.5% tolerance for differences
}

describe('Embroidery Visual Regression', () => {
  let renderer: HeadlessRenderer

  beforeAll(async () => {
    renderer = new HeadlessRenderer(2048)

    // Załaduj generator z pliku JSON
    const generatorData = JSON.parse(
      readFileSync(TEST_CONFIG.generatorPath, 'utf-8')
    )

    await renderer.initialize([])
    await renderer.addGenerator(generatorData)
  }, 60000) // 60s timeout na inicjalizację

  afterAll(() => {
    renderer?.dispose()
  })

  it('should match embroidery baseline image', async () => {
    // 1. Załaduj artwork do testów
    const artworkBuffer = readFileSync(TEST_CONFIG.artworkPath)
    const artworkBase64 = artworkBuffer.toString('base64')

    // 2. Pobierz generator ID
    const generatorData = JSON.parse(
      readFileSync(TEST_CONFIG.generatorPath, 'utf-8')
    )
    const generatorId = generatorData.id
    const regionId = generatorData.regions[0].id

    // Enable transparent background to match baseline
    renderer.setTransparentBackground(true)

    // 3. Renderuj obrazek
    const results = await renderer.renderBatch({
      generatorId,
      images: [{ region: regionId, data: artworkBase64 }],
      colors: [TEST_CONFIG.colorName],
      views: [TEST_CONFIG.viewName],
      renderSize: 2048,
      generatorData, // Pass generator data for region dimensions
    })

    expect(results).toHaveLength(1)
    const renderedBuffer = results[0].buffer

    // 4. Załaduj baseline
    const baselineBuffer = readFileSync(TEST_CONFIG.baselinePath)

    // 5. Porównaj obrazki
    const comparison = compareImages(
      renderedBuffer,
      baselineBuffer,
      TEST_CONFIG.threshold
    )

    // 6. Always save actual for inspection
    const diffDir = join(__dirname, '__diffs__')
    if (!existsSync(diffDir)) mkdirSync(diffDir, { recursive: true })
    writeFileSync(join(diffDir, 'actual.png'), renderedBuffer)

    if (!comparison.match) {
      if (comparison.diffImage) {
        writeFileSync(join(diffDir, 'diff.png'), comparison.diffImage)
      }

      if (comparison.sizeMismatch) {
        console.log(`
        ❌ Embroidery regression test failed - SIZE MISMATCH!
        Actual:   ${comparison.actualSize?.width}x${comparison.actualSize?.height}
        Expected: ${comparison.expectedSize?.width}x${comparison.expectedSize?.height}
        Files saved to: ${diffDir}
        `)
      } else {
        console.log(`
        ❌ Embroidery regression test failed!
        Diff: ${comparison.diffPercent.toFixed(2)}% pixels different
        Files saved to: ${diffDir}
        `)
      }
    }

    expect(comparison.sizeMismatch).toBeFalsy()
    expect(comparison.match).toBe(true)
    expect(comparison.diffPercent).toBeLessThanOrEqual(TEST_CONFIG.threshold)
  }, 30000) // 30s timeout na render
})
