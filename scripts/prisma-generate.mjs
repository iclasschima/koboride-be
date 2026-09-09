import { spawnSync } from "node:child_process";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://kobo:kobo@127.0.0.1:5432/koboride";

const result = spawnSync("npx prisma generate", {
  stdio: "inherit",
  env: process.env,
  shell: true,
});
process.exit(result.status ?? 1);
