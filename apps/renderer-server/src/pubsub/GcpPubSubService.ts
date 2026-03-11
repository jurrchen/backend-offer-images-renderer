import { config } from '../config/index.js'
import type { PubSubService, JobCompletedEvent } from './PubSubService.js'

/**
 * GcpPubSubService — publishes job completion events to GCP Pub/Sub.
 * Used in staging/production environments.
 */
export class GcpPubSubService implements PubSubService {
  private topic: any

  constructor(topic: any) {
    this.topic = topic
  }

  static async create(): Promise<GcpPubSubService> {
    const { PubSub } = await import('@google-cloud/pubsub')
    const client = new PubSub({ projectId: config.gcp.projectId })
    return new GcpPubSubService(client.topic(config.pubsub.topicId))
  }

  async publish(event: JobCompletedEvent): Promise<void> {
    await this.topic.publishMessage({ json: event })
    console.log(`[GcpPubSub] Published job ${event.jobId} to topic "${config.pubsub.topicId}"`)
  }
}
