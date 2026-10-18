# Storage decision for saved modes and remixes

Chosen on 18 October 2026: **Neon Postgres** for mode source, settings, authorship, revisions and remix relationships. The free Neon resource `ekko-remixes` is provisioned in Frankfurt and connected to this Vercel project. Small WebP thumbnails (at most 80 KB) are stored in Postgres alongside scene metadata. A separate Blob store is not required for this release.

EKKO should remain usable after weeks without visitors, without its owner having to resume a project manually. Supabase Free is excluded because projects with low database activity over seven days can be paused and require a dashboard resume. See [Supabase's pausing policy](https://supabase.com/docs/guides/platform/free-project-pausing).

Neon Free suspends idle compute after five minutes and automatically wakes it on the next database query. The first request can take longer while compute starts. Archived branches also reactivate automatically when accessed. This meets the requirement for occasional use without manual reactivation. See [scale to zero](https://neon.com/docs/introduction/scale-to-zero) and [archive storage](https://neon.com/blog/cutting-storage-costs).

Free-tier resource limits still apply. Check [Neon pricing](https://neon.com/pricing) and [Vercel Blob limits](https://vercel.com/docs/vercel-blob/usage-and-pricing) when implementing. Keep local drafts and downloadable exports; cloud persistence is separate from revision history and backups. Editing uses random 256-bit capability keys. Only a SHA-256 hash is stored in the database; the key is returned once on creation. This release has no user accounts or recovery service. Display names are self-reported.

## Setup and data model

Pull the connected development credentials with `vercel env pull .env.local --environment development`. Do not commit this file. Run `npm run db:migrate` to apply the idempotent schema in `server/schema.sql`. Production uses the Marketplace-provided `DATABASE_URL` environment variable. Database credentials are read only by server code and never exposed through Vite's client environment.

`ekko_remixes` stores the current document, visibility, owner-key hash, thumbnail and fork ancestry. `ekko_remix_revisions` stores immutable document revisions. A conditional SQL update checks both the edit key and expected revision, then inserts the new revision in the same statement. The HTTP API returns no key hash. `ekko_remix_limits` bounds write requests by hour using hashed IP buckets and a global bucket. No raw IP is stored.

Unlisted scenes are readable by anyone who has their UUID link. Public scenes additionally appear in the gallery. Keep drafts and editing keys locally, provide JSON exports, and retain independent backups for important work. Free-tier limits can still interrupt service; automatic idle wake-up is separate from quota enforcement.
