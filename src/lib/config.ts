function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

export const config = {
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-insecure-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "14d",

  baseFeeNgn: intEnv("BASE_FEE_NGN", 400),
  perKmFeeNgn: intEnv("PER_KM_FEE_NGN", 250),
  minFareNgn: intEnv("MIN_FARE_NGN", 650),
  /** @deprecated Flat zone fee replaced by distance formula; kept for env compatibility. */
  yabaFlatFeeNgn: intEnv("YABA_FLAT_FEE_NGN", 1000),
  /** Discount for online (Paystack) payment, funded from platform commission. */
  onlinePaymentDiscountNgn: intEnv("ONLINE_PAYMENT_DISCOUNT_NGN", 50),
  /** ₦ off the fare if a customer keeps waiting after a long search. */
  retentionDiscountNgn: intEnv("RETENTION_DISCOUNT_NGN", 100),
  /** Offer the cancel-intercept discount after this many ms searching. */
  stillLookingAfterMs: intEnv("STILL_LOOKING_AFTER_MS", 8 * 60 * 1000),
  /** Auto-cancel (with refund) after this many ms actively searching. */
  searchingAutoCancelAfterMs: intEnv("SEARCHING_AUTO_CANCEL_AFTER_MS", 15 * 60 * 1000),
  /** If a zone has no approved riders, stop searching after this many ms. */
  emptyZoneCancelAfterMs: intEnv("EMPTY_ZONE_CANCEL_AFTER_MS", 8_000),
  /** @deprecated Reschedule delay is unused; kept for env compatibility. */
  rescheduleDelayMs: intEnv("RESCHEDULE_DELAY_MS", 30 * 60 * 1000),
  /** Hard bicycle-delivery cap across every zone. Per-zone radius is the day-to-day limit. */
  maxDeliveryDistanceKm: floatEnv("MAX_DELIVERY_DISTANCE_KM", 10),
  platformCutPercent: intEnv("PLATFORM_CUT_PERCENT", 15),
  /** Optional bearer secret for /api/cron/* (Authorization: Bearer …). */
  cronSecret: process.env.CRON_SECRET ?? "",

  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? "",
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY ?? "",
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:hello@koboride.ng",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  /** Customer-initiated cancels allowed in the rolling window. */
  maxCancelsPerWindow: intEnv("MAX_CANCELS_PER_WINDOW", 3),
  /** Hours that window covers (default 1). */
  cancelWindowHours: intEnv("CANCEL_WINDOW_HOURS", 1),
  /** Default live orders per customer; Admin → Settings can raise this. */
  maxActiveOrders: intEnv("MAX_ACTIVE_ORDERS", 3),
};

export function riderPayoutNgn(feeNgn: number, cutPercent = config.platformCutPercent): number {
  const cut = Math.min(100, Math.max(0, cutPercent));
  return Math.round(feeNgn * (1 - cut / 100));
}
