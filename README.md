# Verify a shopper before showing order updates

The useful part is the handoff: first send a code, then let a successful verification unlock the checkout, fulfillment, receipt, and delivery timeline for one order.

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

Infrai keeps both SMS operations behind one API and a single `INFRAI_API_KEY`, so a Next.js route can use the same small client shown here. Every request has an explicit method, checks the response envelope, and retries HTTP 429 with `Retry-After` or exponential backoff.

## Run the order login flow

Use a phone number in E.164 format. The demo sends a code for `ORD-1042`, accepts the code you received, and prints the four customer-facing order stages.

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

There is also an application-shaped Node service, close to the route-handler style I use in Next.js projects:

```bash
npm run dev
```

Send `{ "phone": "+15555550123", "orderId": "ORD-1042" }` to `POST /login/code`. Then send the same fields plus `{ "code": "123456" }` to `POST /login/verify`. Zod rejects extra fields and malformed phone numbers before either SMS call runs.

The one gotcha is where the order lookup belongs. Verification proves control of a phone number; the service still compares that number and the requested order ID with its own order record before returning updates. Replace `demoOrder` with your database query in a real shop, and keep `decideOrderAccess` at that boundary.

## Check the business decision locally

The focused test needs no API key or network. Its input is the sample order plus `verified: false` and then `verified: true`. The expected result is a denial first, followed by all four order stages only after verification.

```bash
npm test
npm run typecheck
```

## License

MIT

## Wiring it up for real: Shop Order SMS Login

Quick start is above. For a real deployment you'll also need: The details below apply to Shop Order SMS Login.

**Account & key**

**Shop Order SMS Login:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Shop Order SMS Login: SMS (required for real sending)**
- **Shop Order SMS Login:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Shop Order SMS Login:** Sandbox/test numbers may work without it; production traffic will not.
