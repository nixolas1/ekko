# Storage decision for saved modes and remixes

Chosen on 18 October 2026: **Neon Postgres** for mode source, settings, authorship, revisions and remix relationships. Use **Vercel Blob** for preview screenshots if cloud image storage is needed. The editor and storage integration are planned; neither service is provisioned by this change.

EKKO should remain usable after weeks without visitors, without its owner having to resume a project manually. Supabase Free is excluded because projects with low database activity over seven days can be paused and require a dashboard resume. See [Supabase's pausing policy](https://supabase.com/docs/guides/platform/free-project-pausing).

Neon Free suspends idle compute after five minutes and automatically wakes it on the next database query. The first request can take longer while compute starts. Archived branches also reactivate automatically when accessed. This meets the requirement for occasional use without manual reactivation. See [scale to zero](https://neon.com/docs/introduction/scale-to-zero) and [archive storage](https://neon.com/blog/cutting-storage-costs).

Free-tier resource limits still apply. Check [Neon pricing](https://neon.com/pricing) and [Vercel Blob limits](https://vercel.com/docs/vercel-blob/usage-and-pricing) when implementing. Keep local drafts and downloadable exports; cloud persistence is separate from revision history and backups. Authentication remains to be selected during implementation.
