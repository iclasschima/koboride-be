import { OrderStatus, PrismaClient, RiderAvailability, RiderPhase } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed production (this wipes customers, riders, and orders).");
  }

  await prisma.order.deleteMany();
  await prisma.otpCode.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.rider.deleteMany();
  await prisma.admin.deleteMany();

  const adminEmail = (process.env.ADMIN_EMAIL ?? "admin@koboride.ng").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMeNow!";

  await prisma.admin.create({
    data: { email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 10) },
  });

  const adaora = await prisma.customer.create({
    data: { phone: "+2348011111111", name: "Adaora Okeke" },
  });

  const tunde = await prisma.rider.create({
    data: {
      phone: "+2348012345678",
      name: "Tunde O.",
      approved: true,
      availability: RiderAvailability.ONLINE,
    },
  });

  await prisma.rider.create({
    data: {
      phone: "+2348028881212",
      name: "Kemi Balogun",
      approved: false,
      availability: RiderAvailability.OFFLINE,
    },
  });

  await prisma.customer.create({
    data: { phone: tunde.phone, name: tunde.name },
  });

  await prisma.order.create({
    data: {
      status: OrderStatus.dispatching,
      customerId: adaora.id,
      pickup: "Tejuosho Market",
      pickupLat: 6.5078,
      pickupLng: 3.3774,
      dropoff: "Onike",
      dropoffLat: 6.5112,
      dropoffLng: 3.3854,
      notes: "Sealed envelope",
      feeNgn: 1900,
      payoutNgn: 1520,
    },
  });

  await prisma.order.create({
    data: {
      status: OrderStatus.in_progress,
      riderPhase: RiderPhase.en_route_pickup,
      customerId: adaora.id,
      riderId: tunde.id,
      pickup: "Current location · Yaba",
      pickupLat: 6.5095,
      pickupLng: 3.3711,
      dropoff: "Tejuosho Market",
      dropoffLat: 6.5078,
      dropoffLng: 3.3774,
      notes: "A small document pack",
      feeNgn: 1700,
      payoutNgn: 1360,
    },
  });

  await prisma.order.create({
    data: {
      status: OrderStatus.completed,
      riderPhase: RiderPhase.delivered,
      customerId: adaora.id,
      riderId: tunde.id,
      pickup: "Yabatech",
      pickupLat: 6.5186,
      pickupLng: 3.3762,
      dropoff: "Jibowu",
      dropoffLat: 6.5124,
      dropoffLng: 3.3688,
      notes: "Bank forms",
      feeNgn: 1700,
      payoutNgn: 1360,
      payoutPaid: false,
    },
  });

  console.info(`Admin: ${adminEmail} / ${adminPassword}`);
  console.info("Customer: +2348011111111  Rider (approved): +2348012345678");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
