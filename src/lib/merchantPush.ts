const PICKED_UP_PHASES = new Set(["collected", "en_route_dropoff", "delivered"]);

type OrderState = { status: string; riderPhase: string | null };

export type MerchantProgressOrder = OrderState & {
  id: string;
  receiverName: string | null;
  rider?: { name: string | null } | null;
};

/** The shop hears when its bag leaves with the rider and when it reaches the customer. */
export function merchantProgressPush(
  before: OrderState,
  after: MerchantProgressOrder,
): { title: string; body: string; url: string } | null {
  const receiver = after.receiverName?.trim() || "the customer";
  const url = `/merchant/orders/${after.id}`;
  const wasDelivered = before.status === "completed" || before.riderPhase === "delivered";
  const isDelivered = after.status === "completed" || after.riderPhase === "delivered";
  if (isDelivered && !wasDelivered) {
    return { title: "Order delivered", body: `Delivered to ${receiver}`, url };
  }
  const wasPickedUp = PICKED_UP_PHASES.has(before.riderPhase ?? "");
  const isPickedUp = after.status === "in_progress" && PICKED_UP_PHASES.has(after.riderPhase ?? "");
  if (isPickedUp && !wasPickedUp) {
    return {
      title: "Bag picked up",
      body: `${after.rider?.name?.trim() || "The rider"} is taking it to ${receiver}`,
      url,
    };
  }
  return null;
}
