import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson, customerBookingSchema } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { quoteRoute } from "@/lib/fare";
import { assertCustomerCanBook, countActiveOrders, resolveCustomerContacts } from "@/lib/orders";
import { assertServiceOpen, getMaxActiveOrders } from "@/lib/settings";
import { onlinePaymentsEnabled } from "@/lib/payoutFlags";
import {
  initializePaystack,
  nairaToKobo,
  newPaystackReference,
  paystackConfigured,
  paystackEmail,
  paystackPublicKey,
} from "@/lib/paystack";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const user = requireUser(req, ["customer"]);
  if (!paystackConfigured() || !(await onlinePaymentsEnabled())) {
    throw new AppError("Card payment is not available right now", "ONLINE_PAYMENTS_DISABLED", 503);
  }
  await assertServiceOpen();

  const body = parseBody(customerBookingSchema, await readJson(req));
  const customer = await prisma.customer.findUnique({ where: { id: user.sub } });
  if (!customer) throw new AppError("Customer not found", "NOT_FOUND", 404);
  await assertCustomerCanBook(customer.id);

  resolveCustomerContacts({
    customerRole: body.customerRole,
    customerName: customer.name?.trim() || "Customer",
    customerPhone: customer.phone,
    senderName: body.senderName,
    senderPhone: body.senderPhone,
    receiverName: body.receiverName,
    receiverPhone: body.receiverPhone,
  });

  const [quote, maxActiveOrders, active] = await Promise.all([
    quoteRoute({ ...body, paymentMethod: "paystack", customerId: customer.id }),
    getMaxActiveOrders(),
    countActiveOrders(customer.id),
  ]);
  if (active >= maxActiveOrders) {
    throw new AppError(
      `You can have at most ${maxActiveOrders} live orders. Finish or cancel one first.`,
      "ACTIVE_ORDER_LIMIT_REACHED",
      429,
    );
  }

  const email = paystackEmail(customer.phone);
  const started = await initializePaystack({
    email,
    amountKobo: nairaToKobo(quote.feeNgn),
    reference: newPaystackReference(),
    metadata: {
      customerId: customer.id,
      pickup: quote.pickup,
      dropoff: quote.dropoff,
    },
  });

  return json({
    accessCode: started.accessCode,
    reference: started.reference,
    publicKey: paystackPublicKey(),
    email,
    amountKobo: nairaToKobo(quote.feeNgn),
    feeNgn: quote.feeNgn,
  });
});
