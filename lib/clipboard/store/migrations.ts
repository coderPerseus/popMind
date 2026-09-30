// Schema migrations keyed by PRAGMA user_version. v1 is the contract schema (store/schema.ts).
import type { DatabaseSync } from 'node:sqlite'
import { CLIP_SCHEMA_V1, CLIP_SCHEMA_VERSION } from '@/lib/clipboard/store/schema'

type Migration = { version: number; up: (db: DatabaseSync) => void }

const migrations: Migration[] = [{ version: 1, up: (db) => db.exec(CLIP_SCHEMA_V1) }]

export const getUserVersion = (db: DatabaseSync) =>
  ((db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined)?.user_version ?? 0) as number

/** Applies pending migrations; returns the versions applied. */
export const migrateClipDatabase = (db: DatabaseSync): number[] => {
  const current = getUserVersion(db)
  if (current > CLIP_SCHEMA_VERSION) {
    throw new Error(`clipboard database version ${current} is newer than supported ${CLIP_SCHEMA_VERSION}`)
  }

  const applied: number[] = []
  for (const migration of migrations) {
    if (migration.version <= current) {
      continue
    }

    db.exec('BEGIN')
    try {
      migration.up(db)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
      applied.push(migration.version)
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return applied
}
