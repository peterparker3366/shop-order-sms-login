import assert from "node:assert/strict";
import test from "node:test";
import { decideOrderAccess, demoOrder } from "../src/order_access.js";

test("order updates stay private until the phone code is verified", () => {
  assert.deepEqual(decideOrderAccess(demoOrder, false), {
    allowed: false,
    orderId: "ORD-1042",
    reason: "phone_verification_required",
  });

  const access = decideOrderAccess(demoOrder, true);
  assert.equal(access.allowed, true);
  if (access.allowed) {
    assert.deepEqual(access.updates.map((update) => update.stage), [
      "checkout",
      "fulfillment",
      "receipt",
      "customer_update",
    ]);
  }
});
