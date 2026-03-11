import type { BoundingBox } from './types.js'

/**
 * Parse a printArea XAST tree to extract the bounding box from the SVG <path> element.
 *
 * Expected structure: root → <svg> → <g id="regions"> → <path d="...">
 * Supports all SVG rectangle path formats found in Fourthwall generator data.
 */
export function parsePrintAreaBoundingBox(printArea: any): BoundingBox | null {
  if (!printArea?.children) return null

  // Find <svg> element
  const svg = printArea.children.find(
    (n: any) => n.type === 'element' && n.name === 'svg',
  )
  if (!svg?.children) return null

  // Find <g id="regions">
  const regionsGroup = svg.children.find(
    (n: any) => n.type === 'element' && n.name === 'g' && n.attributes?.id === 'regions',
  )
  if (!regionsGroup?.children) return null

  // Find <path>
  const path = regionsGroup.children.find(
    (n: any) => n.type === 'element' && n.name === 'path',
  )
  if (!path?.attributes?.d) return null

  return parseSvgPathRect(path.attributes.d)
}

/**
 * Parse an SVG path describing a rectangle and return its bounding box.
 *
 * Handles all common rectangle path formats found in Fourthwall generator data:
 * absolute/relative M, H, V, L commands with comma or space separators.
 */
function parseSvgPathRect(d: string): BoundingBox | null {
  // Tokenize: split into [command, argsString] pairs
  const commandRe = /([MmHhVvLlZz])\s*((?:[^MmHhVvLlZz])*)/g
  const points: { x: number; y: number }[] = []
  let cx = 0
  let cy = 0
  let match: RegExpExecArray | null

  while ((match = commandRe.exec(d)) !== null) {
    const cmd = match[1]
    const argStr = match[2].trim()

    // Split args on commas, spaces, or before negative signs (but not at start)
    const args = argStr
      ? argStr.split(/[\s,]+|(?=-)/).filter(Boolean).map(Number)
      : []

    switch (cmd) {
      case 'M':
        cx = args[0] ?? cx
        cy = args[1] ?? cy
        points.push({ x: cx, y: cy })
        break
      case 'm':
        cx += args[0] ?? 0
        cy += args[1] ?? 0
        points.push({ x: cx, y: cy })
        break
      case 'H':
        cx = args[0] ?? cx
        points.push({ x: cx, y: cy })
        break
      case 'h':
        cx += args[0] ?? 0
        points.push({ x: cx, y: cy })
        break
      case 'V':
        cy = args[0] ?? cy
        points.push({ x: cx, y: cy })
        break
      case 'v':
        cy += args[0] ?? 0
        points.push({ x: cx, y: cy })
        break
      case 'L':
        cx = args[0] ?? cx
        cy = args[1] ?? cy
        points.push({ x: cx, y: cy })
        break
      case 'l':
        cx += args[0] ?? 0
        cy += args[1] ?? 0
        points.push({ x: cx, y: cy })
        break
      // Z/z — close path, no args needed
    }
  }

  if (points.length < 2) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  const width = maxX - minX
  const height = maxY - minY

  if (!isFinite(width) || !isFinite(height) || width === 0 || height === 0) return null

  return { x: minX, y: minY, width, height }
}
