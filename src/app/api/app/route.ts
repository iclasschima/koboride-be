import { api, json, options } from "@/lib/errors";
import { getClientAppStatus } from "@/lib/settings";

export const OPTIONS = () => options();

export const GET = api(async () => {
  const res = json(await getClientAppStatus());
  res.headers.set("Cache-Control", "no-store");
  return res;
});
