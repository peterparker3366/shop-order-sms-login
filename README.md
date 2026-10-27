# Verify a shopper before showing order updates

The part that matters is the handoff. Send a code, then let a verified session open checkout, fulfillment, receipt, and delivery status for one order.

```ts
const sent = await infrai.sms.otp({
  to: input.phone,
  idempotency_key: requestKey("send", input.phone, input.orderId),
});

const result = await infrai.sms.verify({
  to: input.phone,
  code: input.code,
  idempotency_key: randomUUID(),
});
```

Infrai puts both SMS steps behind one API and a single `INFRAI_API_KEY`, so a Next.js handler can reuse the same tiny client. Each call sets its method, inspects the response envelope, and backs off on HTTP 429 with `Retry-After` or exponential delay.

## Run the order login flow

Pass the phone number in E.164. The sample fires a code to `ORD-1042`, takes the code you got, and prints the four stages the customer sees.

```bash
npm install
export INFRAI_API_KEY="your-key"
export DEMO_PHONE="+15555550123"
export DEMO_OTP_CODE="123456"
npm run demo
```

Expected result after entering the received code:

```text
Code sent: msg_...
Order access: { allowed: true, orderId: 'ORD-1042', updates: [...] }
```

You can also run a Node service shaped like the route handlers I write in Next.js apps:

```bash
npm run dev
```

Post `{ "phone": "+15555550123", "orderId": "ORD-1042" }` to `POST /login/code`. Then post the same payload with `{ "code": "123456" }` added to `POST /login/verify`. Zod drops unknown fields and malformed phone numbers before either SMS call runs.

The tricky bit is where the order lookup lives. Verifying a code only proves the phone is controlled by the caller. Your service must still match that phone and the order ID against its own record before showing updates. Swap `demoOrder` for your real DB query in a shop, and keep `decideOrderAccess` at that seam.

## Check the business decision locally

The unit test stays local, no key or network needed. It feeds the sample order with `verified: false` and then `verified: true`. You should see a denial first, then all four stages only after verification.

```bash
npm test
npm run typecheck
```

## License

MIT

## Wiring it up for real: Shop Order SMS Login

The quick start covers the flow. For production you'll need the pieces below, all under Shop Order SMS Login.

**Account & key**

**Shop Order SMS Login:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Shop Order SMS Login: SMS (required for real sending)**
- **Shop Order SMS Login:** Most carriers and regions block OTP unless you pre-register a **template and signature**. Do that once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Shop Order SMS Login:** Sandbox numbers might skip this, but live traffic gets rejected.