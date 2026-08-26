import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { infrai } from "./infrai_sms.js";
import { decideOrderAccess, type CustomerOrder, type OrderAccess } from "./order_access.js";

export const sendCodeBody = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  orderId: z.string().min(3).max(64),
}).strict();

export const verifyCodeBody = sendCodeBody.extend({
  code: z.string().regex(/^\d{4,8}$/),
}).strict();

const requestKey = (action: string, phone: string, orderId: string) =>
  createHash("sha256").update(`${action}:${phone}:${orderId}`).digest("hex");

export async function sendOrderLoginCode(input: z.infer<typeof sendCodeBody>) {
  return infrai.sms.otp({
    to: input.phone,
    idempotency_key: requestKey("send", input.phone, input.orderId),
  });
}

export async function verifyOrderLogin(
  input: z.infer<typeof verifyCodeBody>,
  order: CustomerOrder,
): Promise<OrderAccess> {
  if (input.orderId !== order.orderId || input.phone !== order.phone) {
    return decideOrderAccess(order, false);
  }

  const result = await infrai.sms.verify({
    to: input.phone,
    code: input.code,
    idempotency_key: randomUUID(),
  });
  return decideOrderAccess(order, result.verified !== false);
}
