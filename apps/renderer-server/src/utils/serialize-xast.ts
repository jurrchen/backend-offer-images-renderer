import type { XastRoot, XastNode, XastElement } from '../designer/types.js'

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function serializeAttributes(attributes: Record<string, string>): string {
  const parts = Object.entries(attributes).map(
    ([key, value]) => `${key}="${escapeAttr(value)}"`
  )
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

function serializeNode(node: XastNode): string {
  switch (node.type) {
    case 'instruction':
      return `<?${node.name} ${node.value}?>`

    case 'text':
      return escapeText(node.value)

    case 'element': {
      const attrs = serializeAttributes(node.attributes)
      if (node.children.length === 0) {
        return `<${node.name}${attrs}/>`
      }
      const children = node.children.map(serializeNode).join('')
      return `<${node.name}${attrs}>${children}</${node.name}>`
    }
  }
}

export function serializeXast(root: XastRoot): string {
  return root.children.map(serializeNode).join('\n')
}
