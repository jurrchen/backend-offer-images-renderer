import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

export interface CompareResult {
  match: boolean
  diffPixels: number
  totalPixels: number
  diffPercent: number
  diffImage?: Buffer
  actualSize?: { width: number; height: number }
  expectedSize?: { width: number; height: number }
  sizeMismatch?: boolean
}

// Normalize transparent pixels (set RGB to 0 when alpha=0)
// This ensures visually identical transparent pixels compare as equal
function normalizeTransparentPixels(data: Buffer): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      data[i] = 0     // R
      data[i + 1] = 0 // G
      data[i + 2] = 0 // B
    }
  }
}

export function compareImages(
  actual: Buffer,
  expected: Buffer,
  threshold = 0.1 // tolerancja na różnice (0.1 = 10%)
): CompareResult {
  const img1 = PNG.sync.read(actual)
  const img2 = PNG.sync.read(expected)

  // Normalize transparent pixels for fair comparison
  normalizeTransparentPixels(img1.data)
  normalizeTransparentPixels(img2.data)

  const actualSize = { width: img1.width, height: img1.height }
  const expectedSize = { width: img2.width, height: img2.height }

  // Check for size mismatch
  if (img1.width !== img2.width || img1.height !== img2.height) {
    console.log(`⚠️ Image size mismatch:`)
    console.log(`   Actual:   ${img1.width}x${img1.height}`)
    console.log(`   Expected: ${img2.width}x${img2.height}`)

    return {
      match: false,
      diffPixels: -1,
      totalPixels: -1,
      diffPercent: 100,
      actualSize,
      expectedSize,
      sizeMismatch: true
    }
  }

  const { width, height } = img1
  const diff = new PNG({ width, height })

  const diffPixels = pixelmatch(
    img1.data,
    img2.data,
    diff.data,
    width,
    height,
    {
      threshold: 0.1, // per-pixel color threshold
      alpha: 0.1,     // alpha channel threshold
      includeAA: true // include anti-aliased pixels
    }
  )

  const totalPixels = width * height
  const diffPercent = (diffPixels / totalPixels) * 100

  return {
    match: diffPercent <= threshold,
    diffPixels,
    totalPixels,
    diffPercent,
    diffImage: PNG.sync.write(diff),
    actualSize,
    expectedSize,
    sizeMismatch: false
  }
}
