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

OTP is skipped when `OTP_SKIP=true` (development). Each user type has its own login.

The frontend (`koboride-fe`) should set `NEXT_PUBLIC_API_URL=http://localhost:3001`.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/health` | uptime |
| POST | `/api/auth/customer/login` `{ phone }` | customer register/sign-in |
| POST | `/api/auth/rider/login` `{ phone }` | rider sign-in (must already exist) |
| POST | `/api/auth/admin/login` `{ email, password }` | ops sign-in |
| POST | `/api/auth/otp/request` `{ phone }` | alias of customer login |
| POST | `/api/auth/otp/verify` `{ phone, code }` | alias of customer login |
| GET/PATCH | `/api/auth/me` `{ name }` | JWT role: customer, rider, or admin |
| GET | `/api/places/autocomplete?q=&session=` | Google Places |
| GET | `/api/places/details?id=&session=` | |
| GET/POST | `/api/orders` | coords required on create |
| GET | `/api/orders/:id` | |
| POST | `/api/orders/:id/cancel` | |
| POST | `/api/orders/:id/auto-assign` | first available / only rider |
| POST | `/api/orders/:id/accept` | rider claims a waiting job |
| POST | `/api/orders/:id/confirm` | |
| POST | `/api/orders/:id/status` | rider advances phase |
| POST | `/api/riders/availability` `{ online }` | |
| GET | `/api/riders/jobs` | |
| GET | `/api/riders/available-jobs` | waiting orders |
| GET | `/api/riders/earnings` | |
| GET | `/api/places/reverse?lat=&lng=` | |
| GET | `/api/admin/customers` | |
| GET | `/api/admin/customers/:id` | |
| GET | `/api/admin/orders` | |
| GET | `/api/admin/orders/:id` | |
| POST | `/api/admin/orders/:id/assign` `{ riderId }` | |
| POST | `/api/admin/orders/:id/override-status` `{ status, phase? }` | |
| POST | `/api/admin/orders/:id/mark-paid` | |
| GET/POST | `/api/admin/riders` | |
| PATCH | `/api/admin/riders/:id` `{ approved }` | |
| DELETE | `/api/admin/riders/:id` | |

Trip `status`: `dispatching` → `in_progress` → `completed`. Rider taps advance `riderPhase`.

Location search uses Places API (New) (`GOOGLE_PLACES_API_KEY`). Empty search on the app is Yaba shortcuts; typing hits Google, biased to Yaba.

Fare is **₦1,500 flat** when both points are inside the Yaba box. Anything outside is rejected. Rider payout is 80%. Tune with `YABA_FLAT_FEE_NGN`.

## Deploy

Use hosted Postgres plus a Node web service. Do not run `prisma db seed` in production — it deletes all rows.

### Render (recommended for this repo)

Render can run **both** the API and Postgres.

**A. Database**

1. In [dashboard.render.com](https://dashboard.render.com) → **New → PostgreSQL**.
2. Same region you will use for the API (e.g. Frankfurt).
3. Copy **Internal Database URL** for the web service (`DATABASE_URL`). Use **External Database URL** only from your laptop (`migrate` / `db:admin`).
4. Add `?sslmode=require` if the URL does not already include SSL.

Apply schema from your machine (once):

```bash
DATABASE_URL="postgresql://...render.com/koboride?sslmode=require" npx prisma migrate deploy
DATABASE_URL="postgresql://..." ADMIN_EMAIL="you@koboride.ng" ADMIN_PASSWORD="a-strong-password" npm run db:admin
```

You can also skip the laptop migrate step: the API **build** already runs `prisma migrate deploy` if `DATABASE_URL` is set.

**B. Web service**

1. **New → Web Service** → connect `iclasschima/koboride-be` (`main`).
2. Settings:

| Field | Value |
| ----- | ----- |
| Runtime | Node |
| Branch | `main` |
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |

3. Environment:

| Name | Value |
| ---- | ----- |
| `NODE_VERSION` | `20` |
| `DATABASE_URL` | Internal URL from the Render Postgres instance (link the database in the dashboard if you can) |
| `JWT_SECRET` | long random string |
| `JWT_EXPIRES_IN` | `14d` |
| `CORS_ORIGIN` | your frontend origin, e.g. `https://koboride-fe.onrender.com` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin login |
| `GOOGLE_PLACES_API_KEY` | Places API (New) |
| `YABA_FLAT_FEE_NGN` | `1500` |
| `PLATFORM_CUT_PERCENT` | `20` |
| `OTP_SKIP` | `true` until SMS is on |

4. Deploy. Open `https://your-service.onrender.com/api/health` → `{ "ok": true }`.
5. Set the frontend `NEXT_PUBLIC_API_URL` to that origin (no trailing slash).

`npm start` listens on Render’s `PORT`. Free web instances sleep when idle; the first request can take ~30s.

If GitHub still has `next start -p 3001`, override **Start command** to:

```bash
npx next start -p $PORT
```

Push the latest `package.json` (`start` uses `${PORT:-3001}`) so you do not need that override.

Neon still works as the database if you only want Render for the API: put Neon’s URL in `DATABASE_URL` instead of Render Postgres.

### 1. Database (Neon) — alternative

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
