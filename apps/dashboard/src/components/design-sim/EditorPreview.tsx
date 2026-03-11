'use client'

import { useRef, useEffect } from 'react'
import ProductEditor, { extensions, controllers } from '@fourthwall/product-editor-library'

/**
 * Recursively rewrite external `href` attributes in the XAST tree to go
 * through the Next.js image proxy, avoiding browser CORS restrictions.
 */
function proxyImageHrefs(node: unknown): unknown {
  if (typeof node !== 'object' || node === null) return node
  if (Array.isArray(node)) return node.map(proxyImageHrefs)

  const obj = node as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const key of Object.keys(obj)) {
    if (key === 'attributes' && typeof obj[key] === 'object' && obj[key] !== null) {
      const attrs = obj[key] as Record<string, unknown>
      if (typeof attrs.href === 'string' && attrs.href.startsWith('http')) {
        result[key] = { ...attrs, href: `/api/image-proxy?url=${encodeURIComponent(attrs.href)}` }
      } else {
        result[key] = attrs
      }
    } else {
      result[key] = proxyImageHrefs(obj[key])
    }
  }

  return result
}

interface Props {
  xastState: unknown  // XAST Root from design response records[0].value
  region: any         // generatorData.regions[] entry
}

export function EditorPreview({ xastState, region }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !xastState) return

    let editor: ProductEditor | null = null

    async function init() {
      editor = new ProductEditor(containerRef.current!, { width: 512, height: 512, pixelRatio: 1 })

      const pixelsWidth = region.dimensions?.pixelsWidth ?? region.pixelsWidth ?? 1800
      const pixelsHeight = region.dimensions?.pixelsHeight ?? region.pixelsHeight ?? 2400
      const inchesWidth = region.dimensions?.inchesWidth ?? region.inchesWidth ?? 12
      const inchesHeight = region.dimensions?.inchesHeight ?? region.inchesHeight ?? 16
      const dpi = region.dimensions?.dpi ?? region.dpi ?? 150

      const controller = await controllers.output({
        region: {
          printArea: { id: region.id, value: region.printArea },
          dimensions: {
            dpi,
            pixels: { width: pixelsWidth, height: pixelsHeight },
            inches: { width: inchesWidth, height: inchesHeight },
          },
        },
      })

      await editor.mount({ printAreaDecorator: extensions.printAreaDecorator }).then(controller)
      await editor.restore({ state: proxyImageHrefs(xastState) as any })
    }

    init().catch(console.error)

    return () => {
      editor?.destroy()
    }
  }, [xastState, region])

  return <div ref={containerRef} style={{ width: 512, height: 512 }} />
}
