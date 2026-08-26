import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { demoOrder } from "./order_access.js";
import {
  sendCodeBody,
  sendOrderLoginCode,
  verifyCodeBody,
  verifyOrderLogin,
} from "./order_login.js";

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/login/code") {
      const input = sendCodeBody.parse(await readJson(request));
      const sent = await sendOrderLoginCode(input);
      return json(response, 202, { orderId: input.orderId, message_id: sent.message_id });
    }
    if (request.method === "POST" && request.url === "/login/verify") {
      const input = verifyCodeBody.parse(await readJson(request));
      const access = await verifyOrderLogin(input, demoOrder);
      return json(response, access.allowed ? 200 : 403, access);
    }
    return json(response, 404, { error: "route_not_found" });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(response, 400, { error: "invalid_request", issues: error.issues });
    }
    return json(response, 502, { error: error instanceof Error ? error.message : "request_failed" });
  }
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Order login service listening on http://localhost:${port}`));
}
