/**
 * StorageService — interface for uploading rendered PNGs.
 * Implementations: LocalStorageService (dev), GcsStorageService (prod).
 */
export interface StorageService {
  upload(buffer: Buffer, key: string): Promise<{ url: string }>
}
