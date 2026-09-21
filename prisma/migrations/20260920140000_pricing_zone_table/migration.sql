-- CreateTable
CREATE TABLE "PricingZone" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "adjacentSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingZone_pkey" PRIMARY KEY ("slug")
);

INSERT INTO "PricingZone" ("slug", "name", "centerLat", "centerLng", "radiusKm", "active", "adjacentSlugs", "createdAt", "updatedAt")
VALUES
  ('YAB', 'Yaba', 6.5055, 3.3795, 4, true, ARRAY['SRL', 'GBG']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('SRL', 'Surulere', 6.4965, 3.354, 4, false, ARRAY['YAB']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('GBG', 'Gbagada', 6.551, 3.389, 4, false, ARRAY['YAB', 'OJK']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('IKJ', 'Ikeja', 6.6018, 3.3515, 4, false, ARRAY['OJK']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AJH', 'Ajah', 6.4698, 3.5683, 4, false, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('LK1', 'Lekki Phase 1', 6.4474, 3.4721, 4, false, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('OJK', 'Ojota/Ketu', 6.5865, 3.3868, 4, false, ARRAY['GBG', 'IKJ']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
