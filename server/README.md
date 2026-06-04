# server/ — RETIRED (not the data path)

**This Express API is no longer used and is not deployed.** As of the Path A
migration, the SiB front-end talks to **Supabase directly** from the browser;
security is enforced by Postgres **Row Level Security** (see
`supabase/migrations/`), not by this server.

Nothing in the live site calls these routes:

- The production site is static (GitHub Pages at `/SiB/`); there is no `/api`
  origin to reach.
- `config.js` no longer defines an `API_BASE`. All data access goes through
  `window._supabase` in `data.js`.
- Auth (signup, login, email verification, Google OAuth, coordinator login) uses
  Supabase Auth directly.

## Why it's kept in the repo

For reference only — the route handlers document the original request/response
shapes and validation rules, which were reproduced (against the real schema and
RLS) when porting to direct Supabase. Treat this folder as historical.

## Do NOT

- Do **not** deploy this server or point the client at it.
- Do **not** add new features here. New server-side logic in Path A belongs in
  **Supabase**: RLS policies, `SECURITY DEFINER` RPCs, database triggers, or
  Supabase **Edge Functions** (e.g. the post-launch items: messaging rate
  limits, coordinator-triggered email verification).

If this folder is ever removed entirely, also delete the `server/.env` you
created locally (it holds the Supabase **service-role** key — never commit it).
