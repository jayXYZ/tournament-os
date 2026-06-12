import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/workos/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.text();
    const signature = request.headers.get("workos-signature");
    const secret = process.env.WORKOS_WEBHOOK_SECRET;

    if (!signature || !secret) {
      return new Response("Missing webhook signature configuration", {
        status: 400,
      });
    }

    const valid = await verifyWorkosSignature(payload, signature, secret);
    if (!valid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const event = JSON.parse(payload) as Record<string, unknown>;
    const eventId = stringField(event, "id");
    const eventName = stringField(event, "event", "event_name");
    if (!eventId || !eventName) {
      return new Response("Unsupported event payload", { status: 400 });
    }

    await ctx.runMutation(internal.workosEvents.process, {
      eventId,
      eventName,
      payload: event,
    });

    return new Response(null, { status: 200 });
  }),
});

async function verifyWorkosSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
) {
  const fields = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );
  const timestamp = fields.t;
  const signature = fields.v1;
  if (!timestamp || !signature) {
    return false;
  }

  const expected = await hmacHex(`${timestamp}.${payload}`, secret);
  return secureCompare(expected, signature);
}

async function hmacHex(payload: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function secureCompare(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

function stringField(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

export default http;
