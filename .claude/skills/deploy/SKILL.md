---
name: deploy
description: Deploy the jotter-cloud Worker with pre-flight gates and a post-deploy check. Use when the user wants to ship a worker change to Cloudflare.
---

# Deploy jotter-cloud

The Worker ships to Cloudflare two ways, and they deploy the same code:

- **Automatic:** Cloudflare Workers Builds deploys the **`main`** branch on push.
  So the normal path is: work on `dev`, open a PR, merge to `main` → it deploys.
- **Immediate/verified:** this skill runs the gates and `wrangler deploy` locally,
  then confirms the live version — use it when you want to ship now and verify,
  without waiting on the git-push build.

Live URL: `https://jotter-cloud.imbyurhan.workers.dev`

## Steps

1. **Be on the intended commit** (normally a clean `main`):

   ```bash
   git checkout main && git pull --ff-only && git status
   ```

2. **Bump the version if the change is meaningful.** `WORKER_VERSION` in
   `src/index.tsx` and `version` in `package.json` must stay in lockstep — the
   desktop app reads `/version` to detect a stale worker. Edit both, same value.

3. **Run the gates:**

   ```bash
   pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
   ```

   `pnpm test` boots a local `wrangler dev` and smoke-checks every route.

4. **Deploy:**

   ```bash
   pnpm deploy   # wrangler deploy — needs wrangler auth
   ```

   (Or just merge to `main` and let Workers Builds deploy.)

5. **Verify live:**
   ```bash
   curl -s https://jotter-cloud.imbyurhan.workers.dev/version
   ```
   Confirm `version` matches what you just shipped and `configured` is `true`. With
   the token, `curl -H "Authorization: Bearer <SYNC_TOKEN>" .../health` → `{"ok":true,...}`.

## Notes

- **`SYNC_TOKEN` is not part of a deploy.** It's a secret set once via
  `printf 'TOKEN' | wrangler secret put SYNC_TOKEN` (printf avoids a trailing
  newline that breaks the match). A git-push deploy does **not** prompt for it, and
  editing it in the dashboard does nothing until you click Deploy there.
- **R2 + D1 auto-provision** from `wrangler.jsonc` on first deploy; the D1 schema
  self-heals at runtime (no migration step).
- If the live `/version` still shows the old number after a git-push deploy, the
  Workers Builds run probably hasn't finished — check the Cloudflare dashboard.
