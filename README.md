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

Each user type has its own login. Customer and rider sign in with phone only — there is no SMS OTP.

The frontend (`koboride-fe`) should set `NEXT_PUBLIC_API_URL=http://localhost:3001`.

Shared staging is the **`develop`** branch on both repos. Production is **`main`**. See [CONTRIBUTING.md](./CONTRIBUTING.md).

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
| POST | `/api/orders/estimate-fare` | coords; 400 `DISTANCE_EXCEEDS_MAX` or `OUTSIDE_SERVICE_AREA` |
| GET/POST | `/api/orders` | coords required on create; 429 `ACTIVE_ORDER_LIMIT_REACHED` |
| GET | `/api/orders/:id` | |
| POST | `/api/push/subscribe` | save Web Push subscription for the JWT user |
| POST | `/api/push/unsubscribe` | `{ endpoint }` |
| POST | `/api/orders/:id/cancel` | `{ reason, note? }` before pickup; 429 `CANCEL_LIMIT_REACHED` (3 / 24h) |
| POST | `/api/orders/:id/auto-assign` | first available / only rider |
| POST | `/api/orders/:id/accept` | rider claims a waiting job |
| POST | `/api/orders/:id/confirm` | leftover delivered jobs; PIN already completes |
| POST | `/api/orders/:id/status` | rider advances phase; to mark delivered send `{ pin }` or `{ skipReason }` (+ optional `photo`) |
| POST | `/api/riders/photo` | multipart `photo`; Cloudinary |
| POST | `/api/riders/availability` `{ online }` | |
| GET | `/api/riders/jobs` | |
| GET | `/api/riders/available-jobs` | waiting orders |
| GET | `/api/riders/earnings` | |
| GET | `/api/places/reverse?lat=&lng=` | |
| GET | `/api/admin/customers` | |
| GET/PATCH | `/api/admin/customers/:id` | PATCH `{ active }` or `{ resetCancelLimit }` |
| GET/PATCH | `/api/admin/settings` | PATCH `{ maxActiveOrders, platformCutPercent }` |
| GET/POST | `/api/admin/orders` | admin can create an order |
| GET/DELETE | `/api/admin/orders/:id` | admin can permanently delete an order |
| POST | `/api/admin/orders/:id/assign` `{ riderId }` | |
| POST | `/api/admin/orders/:id/override-status` `{ status, phase? }` | |
| POST | `/api/admin/orders/:id/mark-paid` | |
| GET/POST | `/api/admin/riders` | multipart: name, phone, photo, government ID, next of kin |
| GET/PATCH/DELETE | `/api/admin/riders/:id` | PATCH JSON or multipart including ID + next of kin |

Trip `status`: `dispatching` → `in_progress` → `completed`. Rider taps advance `riderPhase`. Marking **delivered** requires the 4-digit `deliveryPin` shown on the customer tracking screen, or a documented fallback note (`skipReason`, optional photo) if the receiver cannot produce the PIN. Entering the PIN (or the fallback) completes the order immediately — no customer confirmation step. `completedAt` is stored at that moment; trip payloads include `durationSeconds` from create to complete.

Customers can cancel until the rider picks up the package (`dispatching`, or `in_progress` before `collected`). Cancel requires a reason. After pickup, cancel is blocked (`ALREADY_PICKED_UP`). A customer can cancel at most `MAX_CANCELS_PER_WINDOW` times in `CANCEL_WINDOW_HOURS` (defaults: 3 per 24 hours); further cancels return 429 `CANCEL_LIMIT_REACHED`. An admin can reset that window with `PATCH /api/admin/customers/:id` `{ resetCancelLimit: true }`. A customer can have at most `MAX_ACTIVE_ORDERS` live orders at once (default 3, overridable in Admin → Settings); a 4th create returns 429 `ACTIVE_ORDER_LIMIT_REACHED`. The assigned rider gets a push if the job is cancelled after accept.

Web Push is additive (polling stays). Customers get a push when a rider accepts or marks delivered. Online riders get a push when a new order is waiting. Users opt in from Account / Profile — if they have no `PushSubscription`, sends are skipped.

Location search uses Places API (New) (`GOOGLE_PLACES_API_KEY`). Empty search on the app is Yaba shortcuts; typing hits Google, biased to Yaba.

Fare is **₦1,000 flat** inside the Yaba 4km circle (Alagomeji / Sabo). Outside that is `OUTSIDE_SERVICE_AREA`. Road distance above `MAX_DELIVERY_DISTANCE_KM` (default 10) is `DISTANCE_EXCEEDS_MAX`. Quoted km is stored as `distanceKm`. Rider payout is the fare minus `PLATFORM_CUT_PERCENT` (default 15, overridable in Admin → Settings).

## Deploy

Use hosted Postgres plus a Node web service. Do not run `prisma db seed` in production — it deletes all rows.

To clear sample orders and customers on a hosted DB (keeps admins and riders):

```bash
DATABASE_URL="postgresql://...external-host.../koboride?sslmode=require" \
WIPE_CONFIRM=DELETE_SAMPLE_DATA \
npm run db:wipe-sample
```

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

1. **New → Web Service** → connect `iclasschima/koboride-be` (`main` for production, `develop` for staging — use a **separate** Postgres). See [CONTRIBUTING.md](./CONTRIBUTING.md).
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
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` (same public key as the frontend) |
| `YABA_FLAT_FEE_NGN` | `1000` |
| `MAX_DELIVERY_DISTANCE_KM` | `10` |
| `PLATFORM_CUT_PERCENT` | `15` |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | rider profile photos |

4. Deploy. Open `https://your-service.onrender.com/api/health` → `{ "ok": true }`.
5. Set the frontend `NEXT_PUBLIC_API_URL` to that origin (no trailing slash). Also set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the same public VAPID key.

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
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `YABA_FLAT_FEE_NGN` | `1000` |
| `MAX_DELIVERY_DISTANCE_KM` | `10` |
| `PLATFORM_CUT_PERCENT` | `15` |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | rider profile photos |

3. Deploy. `npm run build` runs `prisma migrate deploy` then `next build`.
4. Check `https://your-api.vercel.app/api/health` → `{ "ok": true }`.
5. Point the frontend `NEXT_PUBLIC_API_URL` at that origin (no trailing slash) and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

Restrict the Google key to your Vercel API host when you can.

### CORS

`CORS_ORIGIN` is a comma-separated list of frontend origins. Localhost is always allowed. Production must list the real FE URL.
