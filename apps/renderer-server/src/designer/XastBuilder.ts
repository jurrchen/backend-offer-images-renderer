import type { XastRoot, XastElement, CenteringResult, BoundingBox } from './types.js'

export function buildXastState(
  boundingBox: BoundingBox,
  artworks: CenteringResult[],
  hrefMap?: Map<string, string>,
): XastRoot {
  const imageElements: XastElement[] = artworks.map((art, index) => ({
    type: 'element',
    name: 'image',
    attributes: {
      href: hrefMap?.get(art.assetId) ?? '',
      width: String(art.scaledWidth),
      height: String(art.scaledHeight),
      transform: `translate(${art.x},${art.y}) rotate(0) scale(1,1)`,
      'data-id': art.assetId,
      'data-name': art.assetId,
      'data-zindex': String(index),
    },
    children: [],
  }))

  const innerSvg: XastElement = {
    type: 'element',
    name: 'svg',
    attributes: {
      x: '50%',
      y: '50%',
      style: 'overflow: visible;',
    },
    children: imageElements,
  }

  const outerSvg: XastElement = {
    type: 'element',
    name: 'svg',
    attributes: {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${boundingBox.width} ${boundingBox.height}`,
    },
    children: [innerSvg],
  }

  return {
    type: 'root',
    children: [outerSvg],
  }
}
