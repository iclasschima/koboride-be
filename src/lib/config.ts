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

  baseFeeNgn: intEnv("BASE_FEE_NGN", 1000),
  perKmFeeNgn: intEnv("PER_KM_FEE_NGN", 200),
  yabaFlatFeeNgn: intEnv("YABA_FLAT_FEE_NGN", 1000),
  /** Hard bicycle-delivery cap, independent of the Yaba zone. */
  maxDeliveryDistanceKm: floatEnv("MAX_DELIVERY_DISTANCE_KM", 10),
  platformCutPercent: intEnv("PLATFORM_CUT_PERCENT", 15),

  sendchampPublicKey: process.env.SENDCHAMP_PUBLIC_KEY ?? "",
  sendchampSender: process.env.SENDCHAMP_SENDER ?? "ChampOTP",
  sendchampBaseUrl: (process.env.SENDCHAMP_BASE_URL ?? "https://api.sendchamp.com/api/v1").replace(
    /\/+$/,
    "",
  ),
  otpDevEcho: process.env.OTP_DEV_ECHO === "true",
  otpSkip: process.env.OTP_SKIP !== "false",
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:hello@koboride.ng",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  isProd: process.env.NODE_ENV === "production",
  /** Minutes after the rider marks delivered before the order auto-completes. */
  autoConfirmMinutes: intEnv("AUTO_CONFIRM_MINUTES", 15),
  /** Customer-initiated cancels allowed in the rolling window. */
  maxCancelsPerWindow: intEnv("MAX_CANCELS_PER_WINDOW", 3),
  /** Hours that window covers (default 24). */
  cancelWindowHours: intEnv("CANCEL_WINDOW_HOURS", 24),
};

export function riderPayoutNgn(feeNgn: number): number {
  return Math.round(feeNgn * (1 - config.platformCutPercent / 100));
}
