import { demoOrder } from "../src/order_access.js";
import { sendOrderLoginCode, verifyOrderLogin } from "../src/order_login.js";

const phone = process.env.DEMO_PHONE;
const code = process.env.DEMO_OTP_CODE;
if (!phone || !code) throw new Error("DEMO_PHONE and DEMO_OTP_CODE are required");

const input = { phone, orderId: demoOrder.orderId };
const sent = await sendOrderLoginCode(input);
console.log("Code sent:", sent.message_id);
console.log("Order access:", await verifyOrderLogin({ ...input, code }, demoOrder));
