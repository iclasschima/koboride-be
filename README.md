# KoboRide API

Pickup & drop-off in Yaba. Cash to the rider. Admin assigns the job.

## Local

```bash
cp .env.example .env
docker compose up -d          # Postgres on :5432
npx prisma migrate deploy
npx prisma db seed            # local only — wipes data
npm run dev                   # :3001
```

Admin: `admin@koboride.ng` / `ChangeMeNow!`

OTP is skipped when `OTP_SKIP=true` (development). Phone sign-in issues a session immediately.

The frontend (`koboride-fe`) should set `NEXT_PUBLIC_API_URL=http://localhost:3001`.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/health` | uptime |
| POST | `/api/auth/otp/request` `{ phone }` | sign-in (OTP skipped in dev) |
| POST | `/api/auth/otp/verify` `{ phone, code }` | used when OTP is on |
| GET/PATCH | `/api/auth/me` `{ name }` | |
| POST | `/api/auth/admin/login` | |
| GET | `/api/places/autocomplete?q=&session=` | Google Places |
| GET | `/api/places/details?id=&session=` | |
| GET/POST | `/api/orders` | coords required on create |
| GET | `/api/orders/:id` | |
| POST | `/api/orders/:id/cancel` | |
| POST | `/api/orders/:id/confirm` | |
| POST | `/api/orders/:id/status` | rider advances phase |
| POST | `/api/riders/availability` `{ online }` | |
| GET | `/api/riders/jobs` | |
| GET | `/api/riders/earnings` | |
| GET | `/api/admin/orders` | |
| GET | `/api/admin/orders/:id` | |
| POST | `/api/admin/orders/:id/assign` `{ riderId }` | |
| POST | `/api/admin/orders/:id/override-status` `{ status, phase? }` | |
| POST | `/api/admin/orders/:id/mark-paid` | |
| GET/POST | `/api/admin/riders` | |
| PATCH | `/api/admin/riders/:id` `{ approved }` | |

Trip `status`: `dispatching` → `in_progress` → `completed`. Rider taps advance `riderPhase`.

Location search uses Places API (New) (`GOOGLE_PLACES_API_KEY`). Empty search on the app is Yaba shortcuts; typing hits Google, biased to Yaba.

Fare is **₦1,500 flat** when both points are inside the Yaba box. Anything outside is rejected. Rider payout is 80%. Tune with `YABA_FLAT_FEE_NGN`.

## Deploy

Use a hosted Postgres for the database and Vercel (or any Node host) for this Next.js API. Do not run `prisma db seed` in production — it deletes all rows.

### 1. Database (Neon)

1. Create a project at [neon.tech](https://neon.tech) (free Postgres).
2. Copy the connection string (`DATABASE_URL`). Use the **pooled** URL for the app if Neon shows one (`-pooler` host), and add `?sslmode=require` if it is missing.
3. From this repo, apply migrations once:

```bash
DATABASE_URL="postgresql://...@....neon.tech/neondb?sslmode=require" npx prisma migrate deploy
```

Supabase, Railway, or Render Postgres work the same way: create Postgres, copy `DATABASE_URL`, run `migrate deploy`.

Create the first admin (safe — does not wipe data):

```bash
DATABASE_URL="postgresql://..." ADMIN_EMAIL="you@koboride.ng" ADMIN_PASSWORD="a-strong-password" npm run db:admin
```

### 2. API (Vercel)

1. Import `iclasschima/koboride-be` in [vercel.com](https://vercel.com).
2. Set environment variables:

| Name | Example |
| ---- | ------- |
| `DATABASE_URL` | Neon URL |
| `JWT_SECRET` | long random string |
| `JWT_EXPIRES_IN` | `14d` |
| `CORS_ORIGIN` | `https://your-frontend.vercel.app` |
| `ADMIN_EMAIL` | admin login |
| `ADMIN_PASSWORD` | admin login |
| `GOOGLE_PLACES_API_KEY` | Places API (New) |
| `YABA_FLAT_FEE_NGN` | `1500` |
| `PLATFORM_CUT_PERCENT` | `20` |
| `OTP_SKIP` | `true` until SMS is ready |

3. Deploy. `npm run build` runs `prisma migrate deploy` then `next build`.
4. Check `https://your-api.vercel.app/api/health` → `{ "ok": true }`.
5. Point the frontend `NEXT_PUBLIC_API_URL` at that origin (no trailing slash).

Restrict the Google key to your Vercel API host when you can. Keep `OTP_SKIP=false` and set Sendchamp vars before real users.

### CORS

`CORS_ORIGIN` is a comma-separated list of frontend origins. Localhost is always allowed. Production must list the real FE URL.
