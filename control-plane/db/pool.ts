import { Pool, type QueryResultRow } from 'pg'
import { config } from '@/lib/config'

let pool: Pool | undefined

export function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: config.databaseUrl })
  return pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return getPool().query<T>(text, params as unknown[])
}
