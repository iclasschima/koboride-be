# Branches

| Branch | Environment | Host |
| ------ | ----------- | ---- |
| `develop` | Shared staging | separate Render API + Postgres |
| `main` | Production | `koboride-be.onrender.com` |

Day-to-day work lands on **`develop`**. Open PRs into `develop`. Promote a release with a PR from `develop` → `main`.

Keep this repo in lockstep with `koboride-fe`: the same branch name on both sides is one environment. Staging frontend talks only to the staging API. Production frontend talks only to the production API.

## Staging service (Render)

Do **not** reuse the production database, JWT secret, admin password, or VAPID keys.

1. **New → PostgreSQL** (e.g. `koboride-be-dev-db`). Same region as the web service.
2. **New → Web Service** → `iclasschima/koboride-be`, branch **`develop`**.
3. Same build/start/health check as production (`npm install && npm run build`, `npm start`, `/api/health`).
4. Environment (staging values only):

| Name | Notes |
| ---- | ----- |
| `DATABASE_URL` | Internal URL of the **staging** Postgres |
| `JWT_SECRET` | New secret, not production |
| `CORS_ORIGIN` | Staging frontend origin (comma-separated if you have more than one) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Staging ops login |
| `GOOGLE_PLACES_API_KEY` | Same key is fine |
| `VAPID_*` | New pair, or a dedicated staging pair. Match `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on the staging frontend |
| `OTP_SKIP` | `true` is fine on staging |

5. Health: `https://<staging-api>.onrender.com/api/health`
6. On the **frontend `develop`** service, set `NEXT_PUBLIC_API_URL` to that origin (no trailing slash).

After the first deploy, `prisma migrate deploy` runs in the build when `DATABASE_URL` is set. Create a staging admin with `npm run db:admin` against the staging URL.
