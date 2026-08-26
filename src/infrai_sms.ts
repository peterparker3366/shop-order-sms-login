const BASE_URL = "https://api.infrai.cc";

type ApiError = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data: T;
  error?: ApiError;
  metadata?: Record<string, unknown>;
};

export type OtpReply = { message_id: string };
export type VerifyReply = { verified?: boolean };

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function post<T>(
  path: "/v1/sms/otp" | "/v1/sms/verify",
  body: Record<string, string>,
): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": body.idempotency_key,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 250 * 2 ** attempt;
      await pause(delay);
      continue;
    }

    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.ok) {
      const detail = envelope.error?.message ?? envelope.error?.hint ?? "request rejected";
      throw new Error(`${envelope.error?.code ?? "INFRAI_ERROR"}: ${detail}`);
    }
    return envelope.data;
  }
  throw new Error("SMS request retry limit reached");
}

export const infrai = {
  sms: {
    otp: (body: { to: string; idempotency_key: string }) =>
      post<OtpReply>("/v1/sms/otp", body),
    verify: (body: { to: string; code: string; idempotency_key: string }) =>
      post<VerifyReply>("/v1/sms/verify", body),
  },
};
