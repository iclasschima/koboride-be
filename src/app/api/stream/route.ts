import { AppError, options, toErrorResponse } from "@/lib/errors";
import { requireCustomer, requireMerchant, requireRider, requireUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/adminAuth";
import { liveReady, subscribeLive } from "@/lib/live";
import { liveEventFor, type LiveAudience, type LiveEvent } from "@/lib/liveEvents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 20_000;
/** Streams end on their own so a changed zone or turned-off account is picked up on reconnect. */
const MAX_STREAM_MS = 10 * 60_000;

export const OPTIONS = () => options();

async function audienceFor(req: Request): Promise<LiveAudience> {
  const user = requireUser(req);
  switch (user.role) {
    case "customer":
      return { kind: "customer", id: (await requireCustomer(req)).id };
    case "rider": {
      const { rider } = await requireRider(req);
      return { kind: "rider", id: rider.id, zoneSlug: rider.zoneSlug };
    }
    case "merchant":
      return { kind: "merchant", id: (await requireMerchant(req)).merchant.id };
    case "admin":
      await requireAdmin(req, "orders");
      return { kind: "admin" };
    default:
      throw new AppError("Live updates are not available for this account", "FORBIDDEN", 403);
  }
}

export async function GET(req: Request) {
  let audience: LiveAudience;
  try {
    audience = await audienceFor(req);
  } catch (err) {
    return toErrorResponse(err);
  }
  if (!(await liveReady())) {
    return toErrorResponse(new AppError("Live updates are unavailable", "LIVE_UNAVAILABLE", 503));
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (event: LiveEvent) => write(`data: ${JSON.stringify(event)}\n\n`);

      const unsubscribe = subscribeLive(
        (raw) => {
          const event = liveEventFor(audience, raw);
          if (event) send(event);
        },
        () => cleanup(),
      );
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      const lifetime = setTimeout(() => cleanup(), MAX_STREAM_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", () => cleanup());

      write("retry: 5000\n\n");
      send({ t: "resync" });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
