import { spawnSync } from "node:child_process";

const realUrl = process.env.DATABASE_URL ?? "";
process.env.DATABASE_URL =
  realUrl || "postgresql://kobo:kobo@127.0.0.1:5432/koboride";

function run(command) {
  const result = spawnSync(command, {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  if (result.status) process.exit(result.status);
}

run("npx prisma generate");
if (realUrl) run("npx prisma migrate deploy");
else console.warn("DATABASE_URL is not set — skipping migrate deploy");
run("npx next build");
