import type { BoundingBox, CenteringResult, ScaleMode } from './types.js'

export function centerArtwork(
  assetId: string,
  artworkWidth: number,
  artworkHeight: number,
  boundingBox: BoundingBox,
  scaleMode: ScaleMode = 'contain',
): CenteringResult {
  let fitScale: number

  switch (scaleMode) {
    case 'contain':
      fitScale = Math.min(boundingBox.width / artworkWidth, boundingBox.height / artworkHeight)
      break
    case 'cover':
      fitScale = Math.max(boundingBox.width / artworkWidth, boundingBox.height / artworkHeight)
      break
    case 'natural':
      fitScale = 1
      break
  }

  const scaledWidth = artworkWidth * fitScale
  const scaledHeight = artworkHeight * fitScale

  // Position: center-relative offset in bounding box coordinate space
  const x = -(scaledWidth / 2)
  const y = -(scaledHeight / 2)

  return {
    assetId,
    originalWidth: artworkWidth,
    originalHeight: artworkHeight,
    scaledWidth,
    scaledHeight,
    x,
    y,
    fitScale,
  }
}
