// Uruchom: npx tsx src/__tests__/generate-baseline.ts

import { HeadlessRenderer } from '../rendering/HeadlessRenderer.js'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function generateBaseline() {
  const renderer = new HeadlessRenderer(2048)

  const generatorPath = join(__dirname, '__fixtures__/embroidery-generator.json')
  const artworkPath = join(__dirname, '__fixtures__/test-artwork.png')
  const outputPath = join(__dirname, '__snapshots__/embroidery-baseline.png')

  const generatorData = JSON.parse(readFileSync(generatorPath, 'utf-8'))
  const artworkBase64 = readFileSync(artworkPath).toString('base64')

  await renderer.initialize([])
  await renderer.addGenerator(generatorData)

  const results = await renderer.renderBatch({
    generatorId: generatorData.id,
    images: [{ region: generatorData.regions[0].id, data: artworkBase64 }],
    colors: ['Black'],  // <- ustawić właściwy kolor
    views: ['Packshot Front'],  // <- ustawić właściwy view
    renderSize: 2048,
  })

  writeFileSync(outputPath, results[0].buffer)
  console.log(`✅ Baseline saved to: ${outputPath}`)

  renderer.dispose()
}

generateBaseline().catch(console.error)
