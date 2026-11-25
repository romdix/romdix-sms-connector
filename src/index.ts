import express, { Express, Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import { GHL } from "./ghl";
import { storage } from "./services/storage";
import { ProviderFactory } from "./services/provider-factory";
import { mapZenderStatus, verifyZenderWebhookSignature } from "./services/zender";
import { verifyGhlSignature } from "./services/webhook-security";
import { addInboundMessage, createContact, lookupContactByPhone, updateMessageStatus } from "./services/ghl-api";
import { startPollers } from "./services/poller";

dotenv.config();

const path = __dirname + "/ui/dist/";
const PORT = process.env.PORT || "3000";

// A predictable secret would let anyone forge sessions, so fall back to a random
// per-process value (sessions simply expire on restart) instead of a constant.
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    console.warn("[Auth] JWT_SECRET is not set — using a random secret for this process.");
    return crypto.randomBytes(32).toString("hex");
  })();

const app: Express = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Keep the raw body: webhook signatures are computed over the exact bytes sent.
app.use(
  express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
// HighLevel webhooks are JSON.
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

const ghl = new GHL();

// --- Helpers ---

type AuthedRequest = Request & { locationId?: string };

function authenticateRequest(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing session token." });
  }
  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET) as any;
    if (!decoded?.locationId) {
      return res.status(401).json({ error: "Unauthorized: Invalid session token." });
    }
    req.locationId = decoded.locationId;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired session token." });
  }
}

/** Debug endpoints only exist when ADMIN_TOKEN is configured and presented. */
function adminOnly(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(404).end();
  const provided = req.header("x-admin-token") || "";
  const ok =
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: "Unauthorized." });
  next();
}

// Small in-memory limiter for endpoints that are cheap to spam.
const rateBuckets = new Map<string, { count: number; reset: number }>();
function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || "unknown"}:${req.path}`;
    const now = Date.now();
    if (rateBuckets.size > 5000) {
      for (const [bucketKey, value] of rateBuckets) {
        if (value.reset < now) rateBuckets.delete(bucketKey);
      }
    }
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
      rateBuckets.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: "Too many requests, try again shortly." });
    }
    next();
  };
}

// --- OAuth install ---

app.get("/authorize-handler", async (req: Request, res: Response) => {
  const { code, location_id, locationId, company_id, companyId } = req.query;
  console.log("[OAuth] Callback received");

  const extractedLocationId = await ghl.authorizationHandler(code as string);
  const finalLocationId = extractedLocationId || (location_id as string) || (locationId as string);
  const finalCompanyId = (company_id as string) || (companyId as string);

  if (finalLocationId && finalCompanyId) {
    storage.saveLocationMapping(finalCompanyId, finalLocationId);
  }
  console.log("[OAuth] Location captured:", finalLocationId ? "yes" : "no");

  // Whitelabel-safe redirect: stay on our own page instead of gohighlevel.com.
  res.redirect("/?installed=1");
});

// --- SSO session ---

app.post("/api/auth/sso", rateLimit(30, 60_000), async (req: Request, res: Response) => {
  const { ssoToken } = req.body || {};
  if (!ssoToken || typeof ssoToken !== "string") {
    return res.status(400).json({ error: "SSO token required." });
  }
  try {
    const ssoData = ghl.decryptSSOData(ssoToken);
    if (!ssoData || !ssoData.activeLocation) {
      return res.status(401).json({ error: "Invalid SSO token." });
    }
    const locationId = ssoData.activeLocation;
    const sessionToken = jwt.sign({ locationId }, JWT_SECRET, { expiresIn: "8h" });
    console.log("[SSO] Authenticated location:", locationId);
    res.json({ sessionToken, locationId });
  } catch (e: any) {
    console.error("[SSO] Failed to decrypt SSO token:", e.message);
    res.status(401).json({ error: "Failed to authenticate SSO token." });
  }
});

// --- Settings ---

app.get("/api/settings", authenticateRequest, (req: AuthedRequest, res: Response) => {
  const locationId = req.locationId!;
  const creds = storage.getCredentials(locationId);
  const providers = (creds?.providers || []).filter((p) => p.type === "zender");
  const defaultProviderId = providers.some((p) => p.id === creds?.defaultProviderId)
    ? creds!.defaultProviderId
    : providers[0]?.id || "";
  res.json({
    defaultProviderId,
    providers,
    inboundKey: storage.getOrCreateInboundKey(locationId),
  });
});

app.post("/api/settings", authenticateRequest, (req: AuthedRequest, res: Response) => {
  const locationId = req.locationId!;
  const { defaultProviderId, providers } = req.body || {};
  if (!Array.isArray(providers)) {
    return res.status(400).json({ error: "providers must be an array." });
  }
  const zenderProviders = providers
    .filter((p) => p && (p.type === "zender" || !p.type))
    .map((p) => ({ ...p, type: "zender" }));
  try {
    storage.saveCredentials(locationId, { defaultProviderId, providers: zenderProviders });
    console.log("[Settings] Saved for location:", locationId);
    res.json({ success: true });
  } catch (e: any) {
    console.error("[Settings] Save failed:", e.message);
    res.status(500).json({ error: "Could not save settings." });
  }
});

/** Disconnect: removes provider credentials and the stored installation. */
app.delete("/api/settings", authenticateRequest, (req: AuthedRequest, res: Response) => {
  const locationId = req.locationId!;
  storage.deleteLocationData(locationId);
  console.log("[Settings] Disconnected location:", locationId);
  res.json({ success: true });
});

// --- Connection test ---

app.post(
  "/api/test-connection",
  rateLimit(20, 60_000),
  authenticateRequest,
  async (req: AuthedRequest, res: Response) => {
    const locationId = req.locationId!;
    const { providerType, providerId } = req.body || {};
    const type = providerType || "zender";

    // The browser never receives stored secrets, so fill blanks from storage.
    const config = { ...(req.body || {}) };
    if (providerId) {
      const stored = storage.getCredentialsRaw(locationId);
      const previous = stored?.providers?.find((p) => p.id === providerId);
      if (previous?.config) {
        for (const field of ["zenderApiKey", "zenderWebhookSecret"]) {
          if (!config[field] && previous.config[field]) config[field] = previous.config[field];
        }
      }
    }

    try {
      const provider = ProviderFactory.getProvider(type);
      await provider.testConnection(config);
      res.json({ success: true, message: "Connection Successful!" });
    } catch (error: any) {
      console.error("[Test] Connection failed:", error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// --- Debug (admin only) ---

app.get("/api/debug/locations", adminOnly, (_req: Request, res: Response) => {
  res.json({ locations: storage.getAllConfiguredLocations() });
});

// --- Admin: restore or rotate a location's inbound key ---

app.get("/api/admin/inbound-key", rateLimit(30, 60_000), adminOnly, (req: Request, res: Response) => {
  const locationId = String(req.query.locationId || "");
  if (!locationId) return res.status(400).json({ error: "locationId is required." });
  res.json({ locationId, key: storage.getOrCreateInboundKey(locationId) });
});

app.post("/api/admin/inbound-key", rateLimit(10, 60_000), adminOnly, (req: Request, res: Response) => {
  const { locationId, key } = req.body || {};
  const normalized = String(key || "").trim().toLowerCase();
  if (!locationId || !/^[a-f0-9]{32,64}$/.test(normalized)) {
    return res.status(400).json({ error: "locationId and a 32-64 character hex key are required." });
  }
  storage.setInboundKey(String(locationId), normalized);
  console.log("[Admin] Inbound key set for location:", locationId);
  res.json({ success: true });
});

// --- Conversation Provider: outbound delivery ---

app.post("/deliver", async (req: Request, res: Response) => {
  const signature = req.headers["x-ghl-signature"] as string | string[] | undefined;
  if (!verifyGhlSignature((req as any).rawBody, signature)) {
    console.warn("[Deliver] Rejected request with missing/invalid signature");
    return res.status(401).json({ error: "Invalid signature." });
  }

  const { locationId, message, phone, messageId, attachments } = req.body || {};

  if (!locationId || !phone || !message) {
    return res.status(400).json({ error: "locationId, phone and message are required." });
  }
  if (Array.isArray(attachments) && attachments.length > 0) {
    return res.status(400).json({ error: "MMS attachments are not supported by this connector." });
  }

  // GHL retries timeouts; never send the same message twice.
  if (messageId && storage.isMessageProcessed(messageId)) {
    console.log("[Deliver] Duplicate delivery ignored:", messageId);
    return res.json({ success: true, duplicate: true });
  }

  const creds = storage.getCredentialsRaw(locationId);
  const zenderProviders = (creds?.providers || []).filter((p) => p.type === "zender");
  if (zenderProviders.length === 0) {
    console.error("[Deliver] No Zender connection configured for location:", locationId);
    return res.status(400).json({ error: "No Zender connection configured for this sub-account." });
  }

  const activeProvider = zenderProviders.find((p) => p.id === creds?.defaultProviderId) || zenderProviders[0];

  let provider;
  try {
    provider = ProviderFactory.getProvider(activeProvider.type);
  } catch (e: any) {
    console.error("[Deliver] Unknown provider type:", activeProvider.type);
    return res.status(400).json({ error: "Provider is misconfigured." });
  }

  try {
    const result = await provider.sendSMS(phone, message, activeProvider.config);
    if (messageId) storage.markMessageProcessed(messageId);

    // Track the provider's message id so the delivery receipt can be polled.
    const providerMessageId = provider.extractMessageId ? provider.extractMessageId(result) : null;
    if (messageId && providerMessageId) {
      storage.saveOutboundMessage({
        ghl_message_id: messageId,
        location_id: locationId,
        provider_id: activeProvider.id,
        provider_message_id: providerMessageId,
      });
    }

    // Keep the HighLevel inbox truthful (sent / failed).
    if (messageId) {
      updateMessageStatus(locationId, messageId, "sent").catch((e) =>
        console.error("[Deliver] Status update failed:", e.message)
      );
    }

    console.log("[Deliver] Sent via", activeProvider.type, "for location:", locationId);
    res.json({ success: true, messageId: messageId || `${activeProvider.type}_${Date.now()}` });
  } catch (e: any) {
    console.error("[Deliver] Provider send failed:", e.message);
    if (messageId) {
      updateMessageStatus(locationId, messageId, "failed", {
        code: "provider_error",
        type: "provider",
        message: "The SMS provider rejected the message.",
      }).catch((err) => console.error("[Deliver] Failure status update failed:", err.message));
    }
    // 400 stops HighLevel from retrying and double-sending.
    res.status(400).json({ error: "The SMS provider could not deliver this message." });
  }
});

// --- Zender webhooks (inbound SMS + delivery status) ---
// Configure in Zender -> Developer -> Webhooks:
//   https://smsconnector.romdix.com/api/inbound/zender?key=<per-location key>
app.post("/api/inbound/zender", rateLimit(120, 60_000), async (req: Request, res: Response) => {
  const rawKey = String(req.query.key || req.header("x-inbound-key") || "");
  let pushKey = rawKey.trim();
  try {
    pushKey = decodeURIComponent(pushKey);
  } catch {
    /* keep raw */
  }
  pushKey = pushKey.trim().toLowerCase();

  const locationId = pushKey ? storage.getLocationByInboundKey(pushKey) : null;
  if (!locationId) {
    console.warn("[Zender] Webhook key missing or not recognised");
    return res.status(401).json({ error: "Unauthorized." });
  }

  const creds = storage.getCredentialsRaw(locationId);
  const zenderProviders = (creds?.providers || []).filter((p) => p.type === "zender");
  if (zenderProviders.length === 0) {
    return res.status(404).json({ error: "No Zender provider configured for this sub-account." });
  }

  // If any configured Zender provider on this location has a webhook secret, verify X-Webhook-Signature.
  const secrets = zenderProviders
    .map((p) => String(p.config?.zenderWebhookSecret || "").trim())
    .filter(Boolean);
  if (secrets.length > 0) {
    const signature = req.header("x-webhook-signature") || req.header("x-gateway-signature");
    const valid = secrets.some((secret) => verifyZenderWebhookSignature((req as any).rawBody, signature, secret));
    if (!valid) {
      console.warn("[Zender] Invalid webhook signature for location:", locationId);
      return res.status(401).json({ error: "Invalid webhook signature." });
    }
  }

  const event = String(req.body?.event || req.header("x-webhook-event") || "").trim().toLowerCase();
  const payload = (req.body?.payload && typeof req.body.payload === "object") ? req.body.payload : (req.body || {});

  if (event === "webhook.test") {
    return res.json({ ok: true, test: true });
  }

  if (event === "sms.received" || String(payload.direction || "").toLowerCase() === "in") {
    const sender = String(payload.from || "").trim();
    const messageBody = payload.body;
    const zenderMsgId = payload.id !== undefined && payload.id !== null ? String(payload.id) : "";

    if (!sender || typeof messageBody !== "string" || !messageBody.trim()) {
      return res.status(400).json({ error: "Inbound SMS payload missing sender or body." });
    }

    const dedupeKey = zenderMsgId
      ? `zender:${locationId}:${zenderMsgId}`
      : `zender:${locationId}:${crypto.createHash("sha256").update(`${sender}|${messageBody}`).digest("hex")}`;
    if (storage.isMessageProcessed(dedupeKey)) {
      return res.json({ ok: true, duplicate: true });
    }

    const digits = sender.replace(/[^0-9]/g, "");
    const phone = digits ? `+${digits}` : sender;

    try {
      let contact = await lookupContactByPhone(locationId, phone);
      if (!contact) contact = await createContact(locationId, phone);
      await addInboundMessage(locationId, {
        contactId: contact.id,
        message: messageBody,
        date: typeof payload.created_at === "string" ? payload.created_at : undefined,
      });
      storage.markMessageProcessed(dedupeKey);
      console.log("[Inbound] Zender message added for location:", locationId);
      return res.json({ ok: true });
    } catch (error: any) {
      console.error("[Inbound] Zender add failed:", error.message);
      return res.status(502).json({ error: "Could not add the inbound message." });
    }
  }

  if (event === "sms.sent" || event === "sms.delivered" || event === "sms.failed" || event === "sms.canceled") {
    const zenderMsgId = payload.id !== undefined && payload.id !== null ? String(payload.id) : "";
    if (!zenderMsgId) {
      return res.json({ ok: true, processed: false });
    }
    const record = storage.getOutboundByProviderMessageIdForLocation(locationId, zenderMsgId);
    if (!record) {
      return res.json({ ok: true, processed: false });
    }

    const eventStatus = event.replace("sms.", "");
    const mapped = mapZenderStatus(payload.status || eventStatus);

    if (mapped === "delivered" || mapped === "failed") {
      try {
        await updateMessageStatus(
          locationId,
          record.ghl_message_id,
          mapped,
          mapped === "failed"
            ? {
                code: String(payload.error || "provider_error"),
                type: "provider",
                message: String(payload.error_reason || payload.error_message || "Zender reported delivery failure."),
              }
            : undefined
        );
      } catch (e: any) {
        console.error("[DLR] Zender status update failed:", e.message);
        return res.status(502).json({ error: "Could not update the message status." });
      }
      storage.deleteOutboundMessage(record.ghl_message_id);
    } else if (mapped === "sent") {
      storage.updateOutboundMessage(record.ghl_message_id, "sent");
    }

    console.log("[DLR] Zender status:", mapped, "for location:", locationId);
    return res.json({ ok: true, processed: true, status: mapped });
  }

  return res.json({ ok: true, ignored: true });
});

// --- HighLevel app webhooks (install / uninstall) ---

app.post("/webhooks/ghl", async (req: Request, res: Response) => {
  const signature = req.headers["x-ghl-signature"] as string | string[] | undefined;
  if (!verifyGhlSignature((req as any).rawBody, signature)) {
    return res.status(401).json({ error: "Invalid signature." });
  }

  const type = String(req.body?.type || req.body?.event || "").toUpperCase();
  const locationId = req.body?.locationId || req.body?.location_id;

  if (type.includes("UNINSTALL") && locationId) {
    storage.deleteLocationData(locationId);
    console.log("[Webhook] Uninstalled and wiped data for location:", locationId);
  }

  res.json({ success: true });
});

// --- App UI ---

app.use(express.static(path));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path + "index.html");
});

app.listen(PORT, () => {
  console.log(`SMS connector listening on port ${PORT}`);
  startPollers();
});
