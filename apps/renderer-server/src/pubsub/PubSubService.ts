/**
 * PubSubService — interface for publishing job completion events.
 * Implementations: GcpPubSubService (prod), LocalPubSubService (dev via Postgres).
 */

export interface JobImageEntry {
  url: string
  size: string
  region: string
  color: string
  style: string
  width: number
  height: number
}

export interface JobCompletedEvent {
  jobId: string
  images: JobImageEntry[]
}

export interface PubSubService {
  publish(event: JobCompletedEvent): Promise<void>
}
