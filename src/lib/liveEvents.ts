/** What the database sends on the "koboride_live" channel. */
export type RawLiveEvent =
  | {
      t: "order";
      id: string;
      status: string;
      prevStatus: string | null;
      customerId: string;
      riderId: string | null;
      prevRiderId: string | null;
      merchantId: string | null;
      zoneSlug: string;
      locOnly: boolean;
      deleted: boolean;
    }
  | { t: "rider"; id: string }
  | { t: "app" };

export type LiveAudience =
  | { kind: "customer"; id: string }
  | { kind: "rider"; id: string; zoneSlug: string }
  | { kind: "merchant"; id: string }
  | { kind: "admin" };

/** What a browser receives. Never carries another person's ids. */
export type LiveEvent =
  | { t: "order"; id: string; status: string; locOnly: boolean }
  | { t: "jobs" }
  | { t: "rider"; id: string }
  | { t: "app" }
  | { t: "resync" };

export function parseRawLiveEvent(payload: string | undefined): RawLiveEvent | null {
  if (!payload) return null;
  try {
    const event = JSON.parse(payload) as RawLiveEvent;
    if (event?.t === "order" && typeof event.id === "string") return event;
    if (event?.t === "rider" && typeof event.id === "string") return event;
    if (event?.t === "app") return { t: "app" };
  } catch {
    /* ignore */
  }
  return null;
}

export function liveEventFor(audience: LiveAudience, raw: RawLiveEvent): LiveEvent | null {
  if (raw.t === "app") return { t: "app" };
  if (raw.t === "rider") {
    return audience.kind === "admin" ? { t: "rider", id: raw.id } : null;
  }

  const order: LiveEvent = { t: "order", id: raw.id, status: raw.status, locOnly: raw.locOnly };
  switch (audience.kind) {
    case "admin":
      return order;
    case "customer":
      return raw.customerId === audience.id ? order : null;
    case "merchant":
      return raw.merchantId === audience.id && !raw.locOnly ? order : null;
    case "rider": {
      if (raw.locOnly) return null;
      if (raw.riderId === audience.id || raw.prevRiderId === audience.id) return order;
      const onBoard = raw.status === "dispatching" || raw.prevStatus === "dispatching";
      return onBoard && raw.zoneSlug === audience.zoneSlug ? { t: "jobs" } : null;
    }
  }
}
