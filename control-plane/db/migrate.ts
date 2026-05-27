import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

// Standalone script (run via tsx) — load .env manually and avoid path aliases.
try { process.loadEnvFile('.env') } catch { /* env may already be set */ }

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set')
  const pool = new Pool({ connectionString: url })
  const sql = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8')
  await pool.query(sql)
  console.log('✓ schema applied')
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
