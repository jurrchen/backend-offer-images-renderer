/**
 * Centralized configuration for renderer-server.
 */

import dotenv from 'dotenv'
import {
  getEnvironment,
  getEnvironmentDefaults,
  type Environment,
  type StorageType,
} from './environments.js'

// Load .env as early as possible (noop in production containers)
dotenv.config()

// ─── Helpers ──────────────────────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
  const v = process.env[key]
  if (!v) return fallback
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? fallback : n
}

function envString(key: string, fallback: string): string {
  return process.env[key] || fallback
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key]
  if (!v) return fallback
  return v === 'true' || v === '1'
}

// ─── Resolve environment ──────────────────────────────────────────────────

const environment = getEnvironment()
const envDefaults = getEnvironmentDefaults(environment)

// ─── Config object ────────────────────────────────────────────────────────

export const config = {
  // ── Environment ────────────────────────────────────────────────────────
  environment,
  isLocal: environment === 'local',
  isStaging: environment === 'staging',
  isProduction: environment === 'prod',

  // ── Server ─────────────────────────────────────────────────────────────
  port: envInt('PORT', 3000),
  logLevel: envString('LOG_LEVEL', environment === 'local' ? 'debug' : 'info'),

  // ── Renderer ───────────────────────────────────────────────────────────
  canvasSize: envInt('CANVAS_SIZE', 2048),

  // ── Worker pool ────────────────────────────────────────────────────────
  worker: {
    count: envInt('WORKER_COUNT', 1),
    jobTimeoutMs: envInt('JOB_TIMEOUT', 120_000),
    maxQueueDepth: envInt('MAX_QUEUE_DEPTH', 500),
    nodeHeapLimitMb: envInt('NODE_HEAP_LIMIT_MB', 512),
    maxRespawns: envInt('MAX_RESPAWNS', 5),
    maxJobsPerWorker: envInt('MAX_JOBS_PER_WORKER', 0),
  },

  // ── Database (pg-boss + Drizzle analytics) ─────────────────────────────
  database: {
    url: envString('DATABASE_URL', ''),
    runMigrationsOnStartup: envBool('RUN_MIGRATIONS_ON_STARTUP', true),
  },

  // ── Job queue (pg-boss) ────────────────────────────────────────────────
  jobs: {
    retryLimit: envInt('JOB_RETRY_LIMIT', 0),
    expireSeconds: envInt('JOB_EXPIRE_SECONDS', 1800),
    archiveAfterSeconds: envInt('JOB_ARCHIVE_AFTER_SECONDS', 604800),
  },

  // ── In-memory job store (fallback when DATABASE_URL is not set) ────────
  jobStore: {
    maxStoredJobs: envInt('MAX_STORED_JOBS', 200),
    resultTtlMs: envInt('JOB_RESULT_TTL_MS', 15 * 60 * 1000),
  },

  // ── Storage ────────────────────────────────────────────────────────────
  storage: {
    type: (envString('LOCAL_OUTPUT_DIR', '') ? 'local' : envDefaults.storageType) as StorageType,
    localOutputDir: envString('LOCAL_OUTPUT_DIR', ''),
    gcsBucket: envDefaults.gcsBucket,
    gcsKeyPrefix: envDefaults.gcsKeyPrefix,
    gcsPublicUrl: envDefaults.gcsPublicUrl,
  },

  // ── GCP ────────────────────────────────────────────────────────────────
  gcp: {
    projectId: envDefaults.gcpProjectId,
  },

  // ── Pub/Sub ────────────────────────────────────────────────────────────
  pubsub: {
    enabled: envDefaults.pubsubEnabled,
    topicId: envDefaults.pubsubTopicId,
  },

  // ── Analytics ──────────────────────────────────────────────────────────
  serverUrl: envString('SERVER_URL', ''),
} as const

export type Config = typeof config

// Re-export types
export type { Environment, StorageType } from './environments.js'
