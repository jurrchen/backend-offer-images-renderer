import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import path from 'node:path'
import { config } from '../config/index.js'
import * as schema from './schema.js'

type AnalyticsDb = ReturnType<typeof drizzle<typeof schema>>

let _db: AnalyticsDb | null = null

export function getAnalyticsDb(): AnalyticsDb {
  if (_db) return _db
  const pool = new Pool({ connectionString: config.database.url, max: 3 })
  _db = drizzle(pool, { schema })
  return _db
}

/**
 * Apply pending Drizzle migrations for the analytics schema.
 * Called once during server startup, before WorkerPoolManager.initialize().
 */
export async function runMigrations(): Promise<void> {
  const db = getAnalyticsDb()
  const migrationsFolder = path.join(process.cwd(), 'src/db/migrations')
  await migrate(db, { migrationsFolder, migrationsSchema: 'analytics' })
  console.log('Analytics migrations applied')
}
