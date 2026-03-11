import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { StorageService } from './StorageService.js'

/**
 * LocalStorageService — stores rendered PNGs on the local filesystem.
 * Used in development when LOCAL_OUTPUT_DIR is set.
 * Files are served via @fastify/static at '/output' in server.ts.
 */
export class LocalStorageService implements StorageService {
  private outputDir: string
  private port: string | number

  constructor(outputDir: string, port: string | number) {
    this.outputDir = outputDir
    this.port = port
  }

  async upload(buffer: Buffer, key: string): Promise<{ url: string }> {
    const filePath = path.join(this.outputDir, key)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, buffer)
    return { url: `http://localhost:${this.port}/output/${key}` }
  }
}
