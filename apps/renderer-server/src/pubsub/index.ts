import { config } from '../config/index.js'
import { GcpPubSubService } from './GcpPubSubService.js'
import type { PubSubService } from './PubSubService.js'

export type { PubSubService, JobCompletedEvent, JobImageEntry } from './PubSubService.js'

/**
 * Factory: returns GcpPubSubService when Pub/Sub is enabled, null otherwise.
 */
export async function createPubSubService(): Promise<PubSubService | null> {
  if (config.pubsub.enabled && config.gcp.projectId) {
    try {
      return await GcpPubSubService.create()
    } catch (err) {
      console.warn('[PubSub] GCP Pub/Sub unavailable:', (err as Error).message)
      return null
    }
  }

  return null
}
