import { defineConfig } from 'vitest/config'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Vitest config — handles non-JS asset imports from @fourthwall/product-renderer:
 * - .glsl files → imported as raw string (shader source)
 * - .jpg/.png files → imported as file path string
 */
export default defineConfig({
  plugins: [
    {
      name: 'glsl-loader',
      transform(code, id) {
        if (id.endsWith('.glsl')) {
          const source = readFileSync(id, 'utf-8')
          return {
            code: `export default ${JSON.stringify(source)};`,
            map: null,
          }
        }
      },
    },
    {
      name: 'asset-path-loader',
      transform(code, id) {
        if (/\.(jpg|jpeg|png)$/.test(id)) {
          return {
            code: `export default ${JSON.stringify(id)};`,
            map: null,
          }
        }
      },
    },
  ],
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/__legacy__/**',
    ],
  },
})
