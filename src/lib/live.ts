import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { parseRawLiveEvent, type RawLiveEvent } from "@/lib/liveEvents";

const CHANNEL = "koboride_live";

type Listener = (event: RawLiveEvent) => void;
type DownListener = () => void;

type Bus = {
  listeners: Set<Listener>;
  downListeners: Set<DownListener>;
  client: Client | null;
  ready: boolean;
  starting: Promise<boolean> | null;
  retryMs: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
};

const globalForLive = globalThis as unknown as { koboLive?: Bus };
const bus: Bus = (globalForLive.koboLive ??= {
  listeners: new Set(),
  downListeners: new Set(),
  client: null,
  ready: false,
  starting: null,
  retryMs: 1_000,
  retryTimer: null,
});

/** LISTEN needs a direct connection; a transaction pooler drops it. Prisma-only URL options are removed. */
function listenUrl(): string {
  const raw = process.env.LISTEN_DATABASE_URL || process.env.DATABASE_URL || "";
  try {
    const url = new URL(raw);
    for (const key of ["schema", "pgbouncer", "connection_limit", "pool_timeout", "connect_timeout"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function markDown(client: Client) {
  if (bus.client !== client) return;
  bus.client = null;
  bus.ready = false;
  client.removeAllListeners();
  client.end().catch(() => {});
  for (const fn of Array.from(bus.downListeners)) fn();
  scheduleRetry();
}

function scheduleRetry() {
  if (bus.retryTimer) return;
  const wait = bus.retryMs;
  bus.retryMs = Math.min(bus.retryMs * 2, 30_000);
  bus.retryTimer = setTimeout(() => {
    bus.retryTimer = null;
    void liveReady();
  }, wait);
}

/** Resolves false when the database listener is down; callers fall back to polling. */
export function liveReady(): Promise<boolean> {
  if (bus.ready) return Promise.resolve(true);
  if (bus.starting) return bus.starting;
  bus.starting = (async () => {
    const client = new Client({ connectionString: listenUrl(), application_name: "koboride-live" });
    client.on("error", (err) => {
      console.error("[live] listener error", err.message);
      markDown(client);
    });
    client.on("end", () => markDown(client));
    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL) return;
      const event = parseRawLiveEvent(msg.payload);
      if (!event) return;
      for (const fn of Array.from(bus.listeners)) fn(event);
    });
    bus.client = client;
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      bus.ready = true;
      bus.retryMs = 1_000;
      return true;
    } catch (err) {
      console.error("[live] could not listen", err instanceof Error ? err.message : err);
      markDown(client);
      return false;
    }
  })().finally(() => {
    bus.starting = null;
  });
  return bus.starting;
}

/** `onDown` fires when the listener drops, since events can be missed until it is back. */
export function subscribeLive(onEvent: Listener, onDown: DownListener): () => void {
  bus.listeners.add(onEvent);
  bus.downListeners.add(onDown);
  return () => {
    bus.listeners.delete(onEvent);
    bus.downListeners.delete(onDown);
  };
}

async function announce(query: Promise<unknown>): Promise<void> {
  try {
    await query;
  } catch (err) {
    console.error("[live] announce failed", err instanceof Error ? err.message : err);
  }
}

/** Tells every open app to reload the public app status, e.g. after ops pauses new orders. */
export function announceAppChange(): Promise<void> {
  return announce(prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify({ t: "app" })})`);
}

/** For order changes that don't write the order row itself. */
export function announceOrderChange(orderId: string): Promise<void> {
  return announce(prisma.$executeRaw`SELECT koboride_order_touched(${orderId})`);
}
