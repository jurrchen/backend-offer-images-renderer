import { config } from '../config/index.js'
import type { StorageService } from './StorageService.js'

/**
 * GcsStorageService — uploads rendered PNGs to Google Cloud Storage.
 * Used in staging/production environments.
 */
export class GcsStorageService implements StorageService {
  private bucket: any

  constructor(bucket: any) {
    this.bucket = bucket
  }

  static async create(): Promise<GcsStorageService> {
    const { Storage } = await import('@google-cloud/storage')
    const storage = new Storage({ projectId: config.gcp.projectId || undefined })
    return new GcsStorageService(storage.bucket(config.storage.gcsBucket))
  }

  async upload(buffer: Buffer, key: string): Promise<{ url: string }> {
    const filename = `${config.storage.gcsKeyPrefix}/${key}`
    await this.bucket.file(filename).save(buffer)
    const url = config.storage.gcsPublicUrl
      ? `${config.storage.gcsPublicUrl}/${filename}`
      : `gs://${config.storage.gcsBucket}/${filename}`
    return { url }
  }
}
