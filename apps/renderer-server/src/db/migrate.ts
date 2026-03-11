import { runMigrations } from './client.js'

async function main() {
  console.log('Starting database migration...')
  await runMigrations()
  console.log('Migration complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
