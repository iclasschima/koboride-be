import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { config } from "@/lib/config";

const PREFIX = "enc:v1:";

function key(): Buffer {
  const secret = process.env.FIELD_ENCRYPTION_KEY?.trim() || config.jwtSecret;
  return scryptSync(secret, "koboride-rider-field", 32);
}

/** Encrypt a sensitive rider field. Stored value is not searchable. */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

/** Decrypt agent-submitted fields. Legacy plaintext is returned unchanged. */
export function decryptField(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !dataB64) return null;
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

/** Stable lookup key so duplicate ID numbers can be rejected without storing them in the clear. */
export function fieldLookup(plain: string): string {
  return createHmac("sha256", key()).update(plain).digest("hex");
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const tail = value.slice(-4);
  return `••••${tail}`;
}
