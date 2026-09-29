import { OrderStatus, PrismaClient, RiderAvailability, RiderIdType, RiderPhase } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptField, fieldLookup } from "../src/lib/fieldCrypto";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed production (this wipes customers, riders, and orders).");
  }

  await prisma.ledgerEntry.deleteMany();
  await prisma.payout.deleteMany();
  await prisma.payoutRun.deleteMany();
  await prisma.reconciliationRun.deleteMany();
  await prisma.onboardingEvent.deleteMany();
  await prisma.agentPayout.deleteMany();
  await prisma.order.deleteMany();
  await prisma.otpCode.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.rider.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.admin.deleteMany();
  await prisma.agentPayConfig.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });

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
      senderName: "Adaora Okeke",
      senderPhone: "+2348011111111",
      receiverName: "Chinedu Okafor",
      receiverPhone: "+2348090001111",
      feeNgn: 1000,
      payoutNgn: 850,
      deliveryPin: "4821",
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
      senderName: "Adaora Okeke",
      senderPhone: "+2348011111111",
      receiverName: "Tejuosho Reception",
      receiverPhone: "+2348082223333",
      feeNgn: 1000,
      payoutNgn: 850,
      deliveryPin: "7390",
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
      senderName: "Adaora Okeke",
      senderPhone: "+2348011111111",
      receiverName: "Jibowu Desk",
      receiverPhone: "+2348074445555",
      feeNgn: 1000,
      payoutNgn: 850,
      payoutPaid: false,
      deliveryPin: "1056",
      deliveryProof: "pin",
      completedAt: new Date(),
    },
  });

  const ada = await prisma.agent.create({
    data: { name: "Ada Nwosu", phone: "+2348090000001", active: true },
  });
  const bola = await prisma.agent.create({
    data: { name: "Bola Adeyemi", phone: "+2348090000002", active: true },
  });

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 8, 10);
  const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

  async function agentRider(input: {
    agentId: string;
    name: string;
    phone: string;
    idNumber: string;
    status: "SUBMITTED" | "ID_VERIFIED" | "APPROVED" | "REJECTED";
    zoneSlug?: string;
    submittedAt: Date;
    approvedAt?: Date;
    firstTenReachedAt?: Date;
    rejectionReason?: string;
  }) {
    return prisma.rider.create({
      data: {
        name: input.name,
        phone: input.phone,
        idType: RiderIdType.nin,
        idNumber: encryptField(input.idNumber),
        idNumberLookup: fieldLookup(input.idNumber),
        bankName: "GTBank",
        bankAccountNo: encryptField("0123456789"),
        nextOfKinName: "Kin " + input.name.split(" ")[0],
        nextOfKinPhone: "+2348091110000",
        zoneSlug: input.zoneSlug ?? "YAB",
        photoWithBikeUrl: "https://www.koboride.ng/icon-192.png",
        selfieUrl: "https://www.koboride.ng/icon-192.png",
        depositPaid: true,
        approved: input.status === "APPROVED",
        idVerified: input.status === "ID_VERIFIED" || input.status === "APPROVED",
        onboardingStatus: input.status,
        submittedAt: input.submittedAt,
        approvedAt: input.approvedAt,
        firstTenReachedAt: input.firstTenReachedAt,
        rejectionReason: input.rejectionReason,
        onboardedByAgentId: input.agentId,
      },
    });
  }

  async function dropoffs(riderId: string, count: number, completedAt: Date) {
    for (let i = 0; i < count; i++) {
      await prisma.order.create({
        data: {
          status: OrderStatus.completed,
          riderPhase: RiderPhase.delivered,
          customerId: adaora.id,
          riderId,
          pickup: "Yaba",
          pickupLat: 6.509,
          pickupLng: 3.371,
          dropoff: "Onike",
          dropoffLat: 6.511,
          dropoffLng: 3.385,
          notes: "Seed delivery",
          senderName: "Adaora Okeke",
          senderPhone: "+2348011111111",
          receiverName: "Receiver",
          receiverPhone: "+2348090001111",
          feeNgn: 800,
          payoutNgn: 680,
          deliveryPin: String(2000 + i).slice(0, 4),
          deliveryProof: "pin",
          completedAt,
          zoneSlug: "YAB",
        },
      });
    }
  }

  await agentRider({
    agentId: ada.id,
    name: "Chioma Eze",
    phone: "+2348031000001",
    idNumber: "10000000001",
    status: "SUBMITTED",
    submittedAt: now,
  });

  const seyi = await agentRider({
    agentId: ada.id,
    name: "Seyi Lawal",
    phone: "+2348031000002",
    idNumber: "10000000002",
    status: "ID_VERIFIED",
    submittedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
  });
  await dropoffs(seyi.id, 2, now);

  const ife = await agentRider({
    agentId: ada.id,
    name: "Ife Okafor",
    phone: "+2348031000003",
    idNumber: "10000000003",
    status: "APPROVED",
    submittedAt: thisMonth,
    approvedAt: thisMonth,
    firstTenReachedAt: now,
  });
  await dropoffs(ife.id, 10, now);

  await agentRider({
    agentId: ada.id,
    name: "Tobi Adebayo",
    phone: "+2348031000004",
    idNumber: "10000000004",
    status: "APPROVED",
    submittedAt: thisMonth,
    approvedAt: thisMonth,
  });

  const ngozi = await agentRider({
    agentId: ada.id,
    name: "Ngozi Umeh",
    phone: "+2348031000005",
    idNumber: "10000000005",
    status: "APPROVED",
    submittedAt: fortyDaysAgo,
    approvedAt: fortyDaysAgo,
    firstTenReachedAt: fortyDaysAgo,
  });
  await dropoffs(ngozi.id, 12, now);

  await agentRider({
    agentId: bola.id,
    name: "Kunle Bello",
    phone: "+2348031000006",
    idNumber: "10000000006",
    status: "REJECTED",
    submittedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    rejectionReason: "ID photo was unreadable",
  });

  console.info(`Admin: ${adminEmail} / ${adminPassword}`);
  console.info("Customer login: +2348011111111");
  console.info("Rider login: +2348012345678");
  console.info("Agent login (OTP): +2348090000001 Ada, +2348090000002 Bola");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
