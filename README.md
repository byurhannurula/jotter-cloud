# jotter-cloud

Self-hosted [Cloudflare Worker](https://developers.cloudflare.com/workers/) that powers the
optional cloud features of [Jotter](https://github.com/byurhannurula/jotter):

- **Sync** — backs up and syncs your drafts across devices (stored in **R2**).
- **Sharing** — turns a note into a read-only link that renders as a clean web page
  (registry in **D1**, so you can revoke or reshare from any device).

Everything is **single-user and opt-in**. You deploy this to _your own_ Cloudflare account,
protect it with a token only you know, and paste the URL + token into Jotter's Sync
settings. Nothing is sent to anyone else.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/byurhannurula/jotter-cloud)

Click the button. Cloudflare clones this repo, **provisions the R2 bucket and D1 database**
from `wrangler.jsonc`, prompts you for the `SYNC_TOKEN` secret, and deploys — you get a
`https://jotter-cloud.<you>.workers.dev` URL.

Then in Jotter: **Settings → Sync** → enable, paste the worker URL and the same token.

> Pick a long random `SYNC_TOKEN` (Jotter's **Generate token** button makes one). It's the
> only thing protecting your notes — treat it like a password.

### Manual / CLI deploy

```bash
pnpm install
wrangler r2 bucket create jotter-cloud
wrangler d1 create jotter-shares      # paste the returned id into wrangler.jsonc
wrangler secret put SYNC_TOKEN        # the same token you enter in the app
wrangler deploy
```

The D1 schema is created automatically on first use — no migration step.

## How it works

```
drafts store ──PUT/GET/DELETE /drafts──►  R2: drafts (sync store)
   (Jotter)   ──POST/DELETE  /share────►  D1: shares  (URL registry)
                              /s/:id  ──►  public rendered note
```

- The desktop app talks to the Worker from a background Rust task; the token never touches
  the webview.
- The Worker is a dumb store: it never merges. Conflict resolution is last-write-wins on
  the client.
- Draft objects are keyed `drafts/<id>.json` with an `updatedAt` metadata stamp for cheap
  delta listing; deletes become tombstones so other devices converge.

## Routes

| Method | Path          | Auth   | Purpose                                      |
| ------ | ------------- | ------ | -------------------------------------------- |
| GET    | `/drafts`     | bearer | List `{ id, updatedAt, deleted }` (delta)    |
| GET    | `/drafts/:id` | bearer | Fetch one draft's JSON                       |
| PUT    | `/drafts/:id` | bearer | Upsert a draft                               |
| DELETE | `/drafts/:id` | bearer | Write a tombstone                            |
| POST   | `/share`      | bearer | Create/replace a share → `{ shareId, url }`  |
| GET    | `/shares`     | bearer | List live shares (the app's cache source)    |
| DELETE | `/share/:id`  | bearer | Revoke a share (the link 404s)               |
| GET    | `/s/:id`      | public | Render the shared note, or 404 if revoked    |
| GET    | `/health`     | bearer | Connection check (app's "Test connection")   |
| GET    | `/version`    | public | Deployed worker version (stale-worker check) |
| GET    | `/`           | public | Friendly landing page                        |

## Develop

```bash
pnpm install
pnpm dev            # wrangler dev (local R2 + D1)
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm format         # prettier --write
```

`.dev.vars` (gitignored) sets the token locally:

```
SYNC_TOKEN=dev-token
```

## License

AGPL-3.0, matching Jotter.
