/**
 * Environment-specific configuration defaults.
 */

export type Environment = 'local' | 'staging' | 'prod'

export type StorageType = 'local' | 'gcs'

export interface EnvironmentDefaults {
  storageType: StorageType

  // GCS
  gcsBucket: string
  gcsKeyPrefix: string
  gcsPublicUrl: string

  // GCP
  gcpProjectId: string

  // Pub/Sub
  pubsubEnabled: boolean
  pubsubTopicId: string
}

const environments: Record<Environment, EnvironmentDefaults> = {
  local: {
    storageType: 'local',
    gcsBucket: '',
    gcsKeyPrefix: 'renders',
    gcsPublicUrl: '',
    gcpProjectId: '',
    pubsubEnabled: false,
    pubsubTopicId: 'renderer-jobs-completed',
  },

  staging: {
    storageType: 'gcs',
    gcsBucket: 'popshop-staging-offer-renderer-assets',
    gcsKeyPrefix: 'renders',
    gcsPublicUrl: 'https://storage.googleapis.com/popshop-staging-offer-renderer-assets',
    gcpProjectId: 'popshop-staging',
    pubsubEnabled: true,
    pubsubTopicId: 'renderer-jobs-completed',
  },

  prod: {
    storageType: 'gcs',
    gcsBucket: 'popshopprod-offer-renderer-assets',
    gcsKeyPrefix: 'renders',
    gcsPublicUrl: 'https://storage.googleapis.com/popshopprod-offer-renderer-assets',
    gcpProjectId: 'popshopprod',
    pubsubEnabled: true,
    pubsubTopicId: 'renderer-jobs-completed',
  },
}

export function getEnvironment(): Environment {
  const env = process.env.ENVIRONMENT || process.env.NODE_ENV
  switch (env) {
    case 'staging':
      return 'staging'
    case 'prod':
    case 'production':
      return 'prod'
    default:
      return 'local'
  }
}

export function getEnvironmentDefaults(env: Environment): EnvironmentDefaults {
  return environments[env]
}
