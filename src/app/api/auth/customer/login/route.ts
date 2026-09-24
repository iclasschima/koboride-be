import { api, options, AppError } from "@/lib/errors";

export const OPTIONS = () => options();

/** Customers sign in with a Termii code. This route no longer issues a session. */
export const POST = api(async () => {
  throw new AppError(
    "Request a verification code to sign in.",
    "OTP_REQUIRED",
    400,
  );
});
