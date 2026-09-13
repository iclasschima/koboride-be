import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.WIPE_CONFIRM !== "DELETE_SAMPLE_DATA") {
    throw new Error(
      'Refusing to wipe. Re-run with WIPE_CONFIRM=DELETE_SAMPLE_DATA if you really want to delete orders, customers, OTPs, and push subscriptions. Admins and riders are kept.',
    );
  }

  const deletedOrders = await prisma.order.deleteMany();
  const deletedOtps = await prisma.otpCode.deleteMany();
  const deletedPush = await prisma.pushSubscription.deleteMany();
  const deletedCustomers = await prisma.customer.deleteMany();

  console.info(
    `Wiped ${deletedOrders.count} orders, ${deletedCustomers.count} customers, ${deletedOtps.count} OTPs, ${deletedPush.count} push subscriptions.`,
  );
  console.info("Admins and riders were left in place.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
