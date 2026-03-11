import sharp from 'sharp'
import type { XastRoot } from './types.js'
import { serializeXast } from '../utils/serialize-xast.js'

export interface PreviewOptions {
  width?: number
  height?: number
  format?: 'png' | 'jpeg'
  quality?: number
  backgroundColor?: string
}

export async function renderPreview(
  xast: XastRoot,
  artworkBuffers: Map<string, Buffer>,
  options: PreviewOptions = {},
): Promise<Buffer> {
  const { format = 'png', quality = 0.92, backgroundColor = 'transparent' } = options

  // Serialize XAST to SVG, embedding artwork images as data URIs
  let svgString = serializeXast(xast)

  // Replace empty hrefs with actual base64 data URIs
  for (const [assetId, buffer] of artworkBuffers) {
    const base64 = buffer.toString('base64')
    const metadata = await sharp(buffer).metadata()
    const mime = metadata.format === 'jpeg' ? 'image/jpeg' : 'image/png'
    const dataUri = `data:${mime};base64,${base64}`

    // Replace the empty href in the image element with matching data-id
    svgString = svgString.replace(
      new RegExp(`href=""([^>]*data-id="${escapeRegex(assetId)}")`),
      `href="${dataUri}"$1`,
    )
  }

  const svgBuffer = Buffer.from(svgString, 'utf-8')

  let pipeline = sharp(svgBuffer)

  if (options.width || options.height) {
    pipeline = pipeline.resize(options.width, options.height, { fit: 'inside' })
  }

  if (backgroundColor && backgroundColor !== 'transparent') {
    pipeline = pipeline.flatten({ background: backgroundColor })
  }

  if (format === 'jpeg') {
    return pipeline.jpeg({ quality: Math.round(quality * 100) }).toBuffer()
  }

  return pipeline.png().toBuffer()
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
