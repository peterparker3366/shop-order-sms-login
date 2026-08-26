export type OrderStage = "checkout" | "fulfillment" | "receipt" | "customer_update";

export type OrderUpdate = {
  stage: OrderStage;
  summary: string;
};

export type CustomerOrder = {
  orderId: string;
  phone: string;
  updates: OrderUpdate[];
};

export type OrderAccess =
  | { allowed: false; orderId: string; reason: "phone_verification_required" }
  | { allowed: true; orderId: string; updates: OrderUpdate[] };

export function decideOrderAccess(order: CustomerOrder, verified: boolean): OrderAccess {
  if (!verified) {
    return {
      allowed: false,
      orderId: order.orderId,
      reason: "phone_verification_required",
    };
  }
  return { allowed: true, orderId: order.orderId, updates: order.updates };
}

export const demoOrder: CustomerOrder = {
  orderId: "ORD-1042",
  phone: "+15555550123",
  updates: [
    { stage: "checkout", summary: "Payment accepted" },
    { stage: "fulfillment", summary: "Warehouse is packing the order" },
    { stage: "receipt", summary: "Receipt attached to the customer account" },
    { stage: "customer_update", summary: "Delivery estimate: Friday" },
  ],
};
