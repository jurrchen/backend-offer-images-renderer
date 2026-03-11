import sharp from 'sharp'

export interface ImageDimensions {
  width: number
  height: number
}

export async function getImageDimensions(input: string | Buffer): Promise<ImageDimensions> {
  let buffer: Buffer

  if (typeof input === 'string') {
    // Strip data URI prefix if present
    const base64Data = input.replace(/^data:image\/\w+;base64,/, '')
    buffer = Buffer.from(base64Data, 'base64')
  } else {
    buffer = input
  }

  const metadata = await sharp(buffer).metadata()

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not determine image dimensions')
  }

  return { width: metadata.width, height: metadata.height }
}

export function stripDataUri(input: string): Buffer {
  const base64Data = input.replace(/^data:image\/\w+;base64,/, '')
  return Buffer.from(base64Data, 'base64')
}
