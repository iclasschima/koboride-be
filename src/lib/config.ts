function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer`);
  return n;
}

export const config = {
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-insecure-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "14d",

  baseFeeNgn: intEnv("BASE_FEE_NGN", 1500),
  perKmFeeNgn: intEnv("PER_KM_FEE_NGN", 200),
  yabaFlatFeeNgn: intEnv("YABA_FLAT_FEE_NGN", 1500),
  platformCutPercent: intEnv("PLATFORM_CUT_PERCENT", 20),

  sendchampPublicKey: process.env.SENDCHAMP_PUBLIC_KEY ?? "",
  sendchampSender: process.env.SENDCHAMP_SENDER ?? "ChampOTP",
  sendchampBaseUrl: (process.env.SENDCHAMP_BASE_URL ?? "https://api.sendchamp.com/api/v1").replace(
    /\/+$/,
    "",
  ),
  otpDevEcho: process.env.OTP_DEV_ECHO === "true",
  otpSkip: process.env.OTP_SKIP !== "false",
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
  isProd: process.env.NODE_ENV === "production",
};

export function riderPayoutNgn(feeNgn: number): number {
  return Math.round(feeNgn * (1 - config.platformCutPercent / 100));
}
