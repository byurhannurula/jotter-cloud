// D1 share registry — the source of truth for which draft is shared at which URL.
// Schema self-creates on first use so the one-click deploy needs no migration step.

export type ShareRow = {
  share_id: string
  draft_id: string
  title: string
  content: string
  created_at: number
}

// Cache the "schema exists" check per isolate so we don't re-run DDL on every request.
let schemaReady = false

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS shares (
         share_id   TEXT PRIMARY KEY,
         draft_id   TEXT NOT NULL,
         title      TEXT NOT NULL,
         content    TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS shares_draft ON shares(draft_id)`),
  ])
  schemaReady = true
}
