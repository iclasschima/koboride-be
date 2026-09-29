import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { riderPayoutNgn } from "./config";
import { riderFareBasisNgn } from "./fare";
import {
  applyFixedOffers,
  fixedListFee,
  nearestOffer,
  offersCustomerCanUse,
  usesLeft,
  type LocationOfferStop,
} from "./locationOffers";

const shop: LocationOfferStop = {
  id: "shop",
  name: "Shoprite",
  address: "12 Herbert Macaulay Way, Yaba",
  lat: 6.5095,
  lng: 3.3711,
  feeNgn: 1_500,
  pickup: true,
  dropoff: true,
  maxUsesPerCustomer: null,
  active: true,
};

const office: LocationOfferStop = {
  id: "office",
  name: "Kobo Office",
  address: "22 Commercial Avenue, Yaba",
  lat: 6.512,
  lng: 3.375,
  feeNgn: 800,
  pickup: false,
  dropoff: true,
  maxUsesPerCustomer: 1,
  active: true,
};

describe("discount uses", () => {
  it("stops a customer who has used their allotment and reports how many are left", () => {
    const used = new Map([["office", 1]]);
    const allowed = offersCustomerCanUse([shop, office], used);
    assert.deepEqual(
      allowed.map((offer) => offer.id),
      ["shop"],
    );
    assert.equal(usesLeft(1, 1), 0);
    assert.equal(usesLeft(3, 1), 2);
    assert.equal(usesLeft(null, 4), null);
  });
});

describe("fixed location fares", () => {
  it("keeps the distance fare when neither stop is an offer", () => {
    assert.equal(fixedListFee(1_200, null, null), 1_200);
  });

  it("allows a free stop to replace the distance fare", () => {
    assert.equal(fixedListFee(1_200, 0, null), 0);
  });

  it("uses the pickup price, the sending price, or the sum of both", () => {
    assert.equal(fixedListFee(1_200, 1_500, null), 1_500);
    assert.equal(fixedListFee(1_200, null, 800), 800);
    assert.equal(fixedListFee(1_200, 1_500, 800), 2_300);
  });

  it("matches a stop only for the role that offer covers", () => {
    assert.equal(nearestOffer([office], office.lat, office.lng, "dropoff")?.id, "office");
    assert.equal(nearestOffer([office], office.lat, office.lng, "pickup"), null);
    assert.equal(nearestOffer([shop], 6.6, 3.4, "pickup"), null);
  });

  it("labels the rider stop with the address and prices the matched ends", () => {
    const quoted = applyFixedOffers({
      listFeeNgn: 1_200,
      pickup: "Current location",
      dropoff: "Somewhere",
      pickupLat: shop.lat,
      pickupLng: shop.lng,
      dropoffLat: office.lat,
      dropoffLng: office.lng,
      offers: [shop, office],
    });
    assert.equal(quoted.listFeeNgn, 2_300);
    assert.equal(quoted.pickup, "Shoprite — 12 Herbert Macaulay Way, Yaba");
    assert.equal(quoted.dropoff, "Kobo Office — 22 Commercial Avenue, Yaba");
  });
});

describe("location discount rider pay", () => {
  it("pays the rider from the distance fare when the location price is lower", () => {
    assert.equal(riderFareBasisNgn(800, 500), 800);
    assert.equal(riderPayoutNgn(riderFareBasisNgn(800, 500), 15), 680);
  });

  it("still pays the distance share when the location is free", () => {
    assert.equal(riderFareBasisNgn(800, 0), 800);
    assert.equal(riderPayoutNgn(riderFareBasisNgn(800, 0), 15), 680);
  });

  it("pays from the location price when that price is higher", () => {
    assert.equal(riderFareBasisNgn(800, 1_500), 1_500);
    assert.equal(riderPayoutNgn(riderFareBasisNgn(800, 1_500), 15), 1_275);
  });
});
