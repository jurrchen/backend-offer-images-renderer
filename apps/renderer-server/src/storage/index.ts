import path from 'node:path'
import { config } from '../config/index.js'
import { LocalStorageService } from './LocalStorageService.js'
import { GcsStorageService } from './GcsStorageService.js'
import type { StorageService } from './StorageService.js'

export type { StorageService }

/**
 * Factory: returns the appropriate StorageService based on config.
 * - storage.type === 'local' → LocalStorageService (dev)
 * - storage.type === 'gcs'   → GcsStorageService (staging/prod)
 * - Neither configured       → null (storage disabled)
 */
export async function createStorageService(): Promise<StorageService | null> {
  if (config.storage.type === 'local' && config.storage.localOutputDir) {
    const outputDir = path.isAbsolute(config.storage.localOutputDir)
      ? config.storage.localOutputDir
      : path.join(process.cwd(), config.storage.localOutputDir)
    return new LocalStorageService(outputDir, config.port)
  }

  if (config.storage.type === 'gcs' && config.storage.gcsBucket) {
    try {
      return await GcsStorageService.create()
    } catch (err) {
      console.warn('[Storage] GCS unavailable:', (err as Error).message)
      return null
    }
  }

  return null
}
