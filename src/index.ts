import express, { Express, Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import { GHL } from "./ghl";
import { storage } from "./services/storage";
import { ProviderFactory } from "./services/provider-factory";
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
// HighLevel webhooks are JSON; provider callbacks (DLR push) arrive as form or text.
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(express.text({ type: ["text/*"], limit: "64kb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
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

/** Provider → app callbacks (inbound SMS / delivery receipts) use a shared secret. */
function providerWebhookGuard(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.INBOUND_WEBHOOK_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: "Inbound webhook is not configured." });
  }
  const provided = req.header("x-webhook-token") || "";
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

/** Reve pushes DLRs as query params or as "Status:0, Message_ID:1, Text:DELIVRD". */
function parseKeyValue(input: any): Record<string, string> {
  if (!input) return {};
  if (typeof input === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "string" || typeof v === "number") out[k.toLowerCase()] = String(v);
    }
    return out;
  }
  const out: Record<string, string> = {};
  for (const part of String(input).split(/[\n,;&]+/)) {
    const match = part.match(/([A-Za-z_]+)\s*[:=]\s*"?([^",]+)"?/);
    if (match) out[match[1].toLowerCase()] = match[2].trim();
  }
  return out;
}

function mapReveStatus(text: string): "sent" | "delivered" | "failed" | "pending" {
  const value = String(text || "").toUpperCase();
  if (/UNDELIV|REJECT|EXPIR|FAIL/.test(value)) return "failed";
  if (/DELIVRD|DELIVERED/.test(value)) return "delivered";
  if (/SENT|ACCEPT/.test(value)) return "sent";
  return "pending";
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
  res.json({
    ...(creds || { defaultProviderId: "", providers: [] }),
    inboundKey: storage.getOrCreateInboundKey(locationId),
  });
});

app.post("/api/settings", authenticateRequest, (req: AuthedRequest, res: Response) => {
  const locationId = req.locationId!;
  const { defaultProviderId, providers } = req.body || {};
  if (!Array.isArray(providers)) {
    return res.status(400).json({ error: "providers must be an array." });
  }
  try {
    storage.saveCredentials(locationId, { defaultProviderId, providers });
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
    const type = providerType || "icombd";

    // The browser never receives stored secrets, so fill blanks from storage.
    const config = { ...(req.body || {}) };
    if (providerId) {
      const stored = storage.getCredentialsRaw(locationId);
      const previous = stored?.providers?.find((p) => p.id === providerId);
      if (previous?.config) {
        for (const field of ["apikey", "secretkey", "pass"]) {
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
  if (!creds || !Array.isArray(creds.providers) || creds.providers.length === 0) {
    console.error("[Deliver] No provider configured for location:", locationId);
    return res.status(400).json({ error: "No provider configured for this sub-account." });
  }

  const activeProvider = creds.providers.find((p) => p.id === creds.defaultProviderId) || creds.providers[0];

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

// --- Inbound SMS (provider → app) ---

app.post("/api/inbound", providerWebhookGuard, async (req: Request, res: Response) => {
  const { locationId, phone, contactId, message, attachments, date, conversationId } = req.body || {};
  if (!locationId || !message) {
    return res.status(400).json({ error: "locationId and message are required." });
  }

  try {
    let resolvedContactId = contactId as string | undefined;
    if (!resolvedContactId && phone) {
      const contact = await lookupContactByPhone(locationId, String(phone));
      resolvedContactId = contact?.id;
    }
    if (!resolvedContactId && !conversationId) {
      return res.status(404).json({ error: "No contact found for this phone number." });
    }

    await addInboundMessage(locationId, {
      contactId: resolvedContactId,
      conversationId,
      message: String(message),
      attachments: Array.isArray(attachments) ? attachments : undefined,
      date,
    });
    console.log("[Inbound] Message added for location:", locationId);
    res.json({ success: true });
  } catch (e: any) {
    console.error("[Inbound] Failed:", e.message);
    res.status(502).json({ error: "Could not deliver the inbound message." });
  }
});

// --- Delivery receipts (provider → app) ---

app.post("/api/dlr", providerWebhookGuard, async (req: Request, res: Response) => {
  const { locationId, messageId, status, error } = req.body || {};
  const allowed = ["sent", "delivered", "read", "failed"];
  if (!locationId || !messageId || !allowed.includes(status)) {
    return res.status(400).json({ error: "locationId, messageId and a valid status are required." });
  }
  try {
    await updateMessageStatus(locationId, String(messageId), status, error);
    res.json({ success: true });
  } catch (e: any) {
    console.error("[DLR] Status update failed:", e.message);
    res.status(502).json({ error: "Could not update the message status." });
  }
});

// --- Inbound SMS pushed by Reve ---
// Reve does not expose an inbox API; they POST { sender, receiver, message } to a URL we give them.
const recentReveInbound = new Map<string, number>();

app.all("/api/inbound/reve", rateLimit(120, 60_000), async (req: Request, res: Response) => {
  // Reve may POST JSON or call with GET query parameters; accept both.
  const params = { ...parseKeyValue(req.query), ...parseKeyValue(req.body) };
  const sender = params.sender || params.from || params.msisdn;
  const receiver = params.receiver || params.to;
  const message = params.message || params.text || params.body;

  // Preferred: a per-sub-account key, so one customer can never post into another's account.
  const pushKey = String(params.key || req.header("x-inbound-key") || "");
  console.log(
    "[Inbound] Reve push received:",
    req.method,
    "| key:",
    pushKey ? "yes" : "no",
    "| receiver:",
    receiver || "none",
    "| message:",
    message ? "yes" : "no"
  );

  if (!sender || !receiver || !message) {
    return res.status(400).json({ error: "sender, receiver and message are required." });
  }

  const digits = (value: any) => String(value || "").replace(/[^0-9]/g, "");
  const receiverDigits = digits(receiver);
  let matches: Array<{ locationId: string; provider: any }> = [];

  if (pushKey) {
    const locationId = storage.getLocationByInboundKey(pushKey);
    if (!locationId) {
      console.warn("[Inbound] Reve key not recognised");
      return res.status(401).json({ error: "Unauthorized." });
    }
    const creds = storage.getCredentialsRaw(locationId);
    matches = (creds?.providers || [])
      .filter((provider) => provider.type === "revesms")
      .map((provider) => ({ locationId, provider }));
    if (matches.length === 0) {
      return res.status(404).json({ error: "No Reve provider configured for this sub-account." });
    }
  } else {
    // Legacy: shared token + receiver-number match.
    const expected = process.env.INBOUND_WEBHOOK_TOKEN;
    if (!expected) {
      return res.status(503).json({ error: "Inbound webhook is not configured." });
    }
    const token = req.header("x-webhook-token") || String(params.token || "");
    const authorized =
      token.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!authorized) return res.status(401).json({ error: "Unauthorized." });

    matches = storage
      .listConfiguredProviders("revesms")
      .filter((item) => digits(item.provider.config?.callerID) === receiverDigits);
    if (matches.length === 0) {
      console.warn("[Inbound] Reve message for an unconfigured receiver number");
      return res.status(404).json({ error: "No sub-account configured for this receiver number." });
    }
  }

  // Reve sends no message id and may retry, so suppress identical repeats for 2 minutes.
  const key = `reve:${digits(sender)}:${receiverDigits}:${String(message).slice(0, 64)}`;
  const seenAt = recentReveInbound.get(key);
  if (seenAt && Date.now() - seenAt < 120_000) {
    return res.json({ success: true, duplicate: true });
  }

  const phone = `+${digits(sender)}`;
  for (const match of matches) {
    try {
      let contact = await lookupContactByPhone(match.locationId, phone);
      if (!contact) contact = await createContact(match.locationId, phone);
      await addInboundMessage(match.locationId, { contactId: contact.id, message: String(message) });
      recentReveInbound.set(key, Date.now());
      if (recentReveInbound.size > 500) {
        const cutoff = Date.now() - 120_000;
        for (const [k, v] of recentReveInbound) if (v < cutoff) recentReveInbound.delete(k);
      }
      console.log("[Inbound] Reve message added for location:", match.locationId);
      return res.json({ success: true });
    } catch (error: any) {
      console.error("[Inbound] Reve add failed:", error.message);
    }
  }

  return res.status(502).json({ error: "Could not add the inbound message." });
});

// --- Delivery receipts (Reve push) ---
// Configure in Reve: https://smsconnector.romdix.com/api/dlr/reve?apikey=...&secretkey=...&status=REPLACE_STATUS&text=REPLACE_TEXT&messageid=REPLACE_ID
app.all("/api/dlr/reve", rateLimit(120, 60_000), async (req: Request, res: Response) => {
  const params = { ...parseKeyValue(req.query), ...parseKeyValue(req.body) };
  const apikey = params.apikey;
  const secretkey = params.secretkey;
  const messageId = params.messageid || params.message_id;
  const rawStatus = params.text || params.status_text || params.status || "";

  if (!apikey || !secretkey || !messageId) {
    return res.status(400).json({ error: "apikey, secretkey and messageid are required." });
  }

  const matches = storage
    .listConfiguredProviders("revesms")
    .filter((x) => x.provider.config?.apikey === apikey && x.provider.config?.secretkey === secretkey);
  if (matches.length === 0) {
    console.warn("[DLR] Unknown Reve credentials");
    return res.status(401).json({ error: "Unknown credentials." });
  }

  const record = storage.getOutboundByProviderMessageId(String(messageId));
  if (!record) {
    // Status for a message we did not track (e.g. sent before this deploy).
    return res.json({ ok: true, processed: false });
  }
  if (!matches.some((m) => m.locationId === record.location_id)) {
    return res.status(401).json({ error: "Credentials do not match this message." });
  }

  const status = mapReveStatus(rawStatus);
  if (status === "delivered" || status === "failed") {
    try {
      await updateMessageStatus(
        record.location_id,
        record.ghl_message_id,
        status,
        status === "failed"
          ? { code: "provider_error", type: "provider", message: "Carrier reported the message as undelivered." }
          : undefined
      );
    } catch (e: any) {
      console.error("[DLR] Status update failed:", e.message);
      return res.status(502).json({ error: "Could not update the message status." });
    }
    storage.deleteOutboundMessage(record.ghl_message_id);
  } else {
    storage.updateOutboundMessage(record.ghl_message_id, status);
  }

  console.log("[DLR] Reve status:", status);
  res.json({ ok: true, processed: true, status });
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
