/*you provided is a TypeScript code that sets up an Express server and defines several routes
for handling HTTP requests. */
import express, { Express, Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import { GHL } from "./ghl";
import * as CryptoJS from 'crypto-js'
import jwt from 'jsonwebtoken';

import { storage } from "./services/storage";
import { ProviderFactory } from "./services/provider-factory";

const path = __dirname + "/ui/dist/";

dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production_jwt_secret';
const app: Express = express();
app.use(express.json());

// --- JWT Authentication Middleware ---
function authenticateRequest(req: Request & { locationId?: string }, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing session token.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.locationId = decoded.locationId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired session token.' });
  }
}

/*`app.use(express.static(path));` is setting up a middleware in the Express server. The
`express.static` middleware is used to serve static files such as HTML, CSS, JavaScript, and images. */
app.use(express.static(path));

/* The line `const ghl = new GHL();` is creating a new instance of the `GHL` class. It is assigning
this instance to the variable `ghl`. This allows you to use the methods and properties defined in
the `GHL` class to interact with the GoHighLevel API. */
const ghl = new GHL();

const port = process.env.PORT;

/*`app.get("/authorize-handler", async (req: Request, res: Response) => { ... })` sets up an example how you can authorization requests */
app.get("/authorize-handler", async (req: Request, res: Response) => {
  const { code, location_id, locationId, company_id, companyId } = req.query;

  console.log("OAuth callback received:", { code, location_id, locationId, company_id, companyId });

  const extractedLocationId = await ghl.authorizationHandler(code as string);
  const finalLocationId = extractedLocationId || (location_id as string) || (locationId as string);
  const finalCompanyId = (company_id as string) || (companyId as string);

  if (finalLocationId && finalCompanyId) {
    storage.saveLocationMapping(finalCompanyId, finalLocationId);
  }

  console.log("Location ID captured:", finalLocationId);

  res.redirect("https://app.gohighlevel.com/");
});

/*`app.get("/example-api-call", async (req: Request, res: Response) => { ... })` shows you how you can use ghl object to make get requests
 ghl object in abstract would handle all of the authorization part over here. */
app.get("/example-api-call", async (req: Request, res: Response) => {
  if (ghl.checkInstallationExists(req.query.companyId as string)) {
    try {
      const request = await ghl
        .requests(req.query.companyId as string)
        .get(`/users/search?companyId=${req.query.companyId}`, {
          headers: {
            Version: "2021-07-28",
          },
        });
      return res.send(request.data);
    } catch (error) {
      console.log(error);
    }
  }
  return res.send("Installation for this company does not exists");
});

/*`app.get("/example-api-call-location", async (req: Request, res: Response) => { ... })` shows you how you can use ghl object to make get requests
 ghl object in abstract would handle all of the authorization part over here. */
app.get("/example-api-call-location", async (req: Request, res: Response) => {
  /* The line `if(ghl.checkInstallationExists(req.params.locationId)){` is checking if an
    installation already exists for a specific location. It calls the `checkInstallationExists`
    method of the `GHL` class and passes the `locationId` as a parameter. This method checks if
    there is an existing installation for the provided locationId and returns a boolean value
    indicating whether the installation exists or not. */
  try {
    if (ghl.checkInstallationExists(req.params.locationId)) {
      const request = await ghl
        .requests(req.query.locationId as string)
        .get(`/contacts/?locationId=${req.query.locationId}`, {
          headers: {
            Version: "2021-07-28",
          },
        });
      return res.send(request.data);
    } else {
      /* NOTE: This flow would only work if you have a distribution type of both Location & Company & OAuth read-write scopes are configured. 
        The line `await ghl.getLocationTokenFromCompanyToken(req.query.companyId as string, req.query.locationId as string)`
         is calling the `getLocationTokenFromCompanyToken` method of the
        `GHL` class. This method is used to retrieve the location token for a specific location within a company. */
      await ghl.getLocationTokenFromCompanyToken(
        req.query.companyId as string,
        req.query.locationId as string
      );
      const request = await ghl
        .requests(req.query.locationId as string)
        .get(`/contacts/?locationId=${req.query.locationId}`, {
          headers: {
            Version: "2021-07-28",
          },
        });
      return res.send(request.data);
    }
  } catch (error) {
    console.log(error);
    res.send(error).status(400)
  }
});

/*`app.post("example-webhook-handler",async (req: Request, res: Response) => {
    console.log(req.body)
})` sets up a route for handling HTTP POST requests to the "/example-webhook-handler" endpoint. The below POST
api can be used to subscribe to various webhook events configured for the app. */
app.post("/example-webhook-handler", async (req: Request, res: Response) => {
  console.log(req.body)
})


/* API Route to Get Location Mapping */
/* SSO Authentication Endpoint - exchange GHL's SSO token for a session JWT */
app.post("/api/auth/sso", async (req: Request, res: Response) => {
  const { ssoToken } = req.body;
  if (!ssoToken) return res.status(400).json({ error: 'SSO token required.' });
  try {
    const ssoData = ghl.decryptSSOData(ssoToken);
    if (!ssoData || !ssoData.activeLocation) {
      return res.status(401).json({ error: 'Invalid SSO token.' });
    }
    const locationId = ssoData.activeLocation;
    const sessionToken = jwt.sign({ locationId }, JWT_SECRET, { expiresIn: '8h' });
    console.log('[SSO] Authenticated location:', locationId);
    res.json({ sessionToken, locationId });
  } catch (e: any) {
    console.error('[SSO] Failed to decrypt SSO token:', e.message);
    res.status(401).json({ error: 'Failed to authenticate SSO token.' });
  }
});

app.get("/api/location-mapping", async (req: Request, res: Response) => {
  const companyId = req.query.companyId as string;
  if (!companyId) return res.status(400).send("Company ID required");
  const locationId = storage.getLocationMapping(companyId);
  res.json({ locationId });
});

/* API Route to Get Settings — requires session JWT */
app.get("/api/settings", authenticateRequest, async (req: Request & { locationId?: string }, res: Response) => {
  const locationId = req.locationId!;
  const creds = storage.getCredentials(locationId);
  res.json(creds || { defaultProviderId: '', providers: [] });
});

/* Debug Route - List stored locations */
app.get("/api/debug/locations", (req: Request, res: Response) => {
  res.json({ locations: storage.getAllConfiguredLocations() });
});

/* API Route to Save Settings — requires session JWT */
app.post("/api/settings", authenticateRequest, async (req: Request & { locationId?: string }, res: Response) => {
  const locationId = req.locationId!;
  console.log("Saving settings for:", locationId);
  const { defaultProviderId, providers } = req.body;
  try {
    storage.saveCredentials(locationId, { defaultProviderId, providers });
    console.log("Settings saved for:", locationId);
    res.json({ success: true });
  } catch (e: any) {
    console.error("Storage save error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* API Route to Test Connection — no auth required, only tests supplied credentials */
app.post("/api/test-connection", async (req: Request, res: Response) => {
  const { providerType } = req.body;

  // Default to icombd if not specified
  const type = providerType || 'icombd';

  try {
    const provider = ProviderFactory.getProvider(type);
    // Pass the entire request body since different providers need different fields
    const result = await provider.testConnection(req.body);
    res.json({ success: true, message: "Connection Successful!" });
  } catch (error: any) {
    console.error("Test Connection Failed:", error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

let lastDeliverError: any = null;

app.get("/api/last-error", (req: Request, res: Response) => {
  res.json({ error: lastDeliverError || "No recent delivery error found" });
});

/* Webhook for GHL Connector - Outbound Message */
app.post("/deliver", async (req: Request, res: Response) => {
  console.log("Received /deliver webhook:", JSON.stringify(req.body));
  try {
    const { locationId, message, phone, type } = req.body;

    // GHL sends:
    // - message: the text content (string)
    // - phone: the recipient phone number
    // - locationId: the GHL location ID

    if (!message || !phone) {
      console.error("Invalid payload: missing message or phone");
      lastDeliverError = { time: new Date().toISOString(), msg: "Invalid payload: missing message or phone", payload: req.body };
      return res.status(400).send("Invalid payload: missing message or phone");
    }

    if (!locationId) {
      console.error("Invalid payload: missing locationId");
      lastDeliverError = { time: new Date().toISOString(), msg: "Invalid payload: missing locationId", payload: req.body };
      return res.status(400).send("Invalid payload: missing locationId");
    }

    // Get stored credentials including providerType
    const creds = storage.getCredentials(locationId);
    if (!creds || !creds.providers || creds.providers.length === 0) {
      console.error("No credentials configured for location:", locationId);
      lastDeliverError = { time: new Date().toISOString(), msg: "No credentials configured for this location", locationId: locationId, payload: req.body };
      return res.status(400).send("No credentials configured for this location.");
    }

    // Find the default provider, or fallback to the first one available
    const activeProvider = creds.providers.find(p => p.id === creds.defaultProviderId) || creds.providers[0];
    const providerType = activeProvider.type;

    // Get Provider Instance
    let provider;
    try {
      provider = ProviderFactory.getProvider(providerType);
    } catch (e: any) {
      console.error("Provider factory error:", e.message);
      return res.status(400).send(e.message);
    }

    // Send SMS using the active provider's specific config
    console.log(`Sending SMS via ${providerType} to ${phone}: ${message}`);
    const result = await provider.sendSMS(phone, message, activeProvider.config);

    console.log("Provider Success:", result);
    // Return success to GHL
    res.json({ messageId: `${providerType}_` + Date.now(), providerResponse: result });

  } catch (error: any) {
    console.error("Delivery Failed:", error.message);
    lastDeliverError = { time: new Date().toISOString(), msg: error.message, payload: req.body };
    // Return 400 Bad Request for configuration/validation errors instead of 500 Internal Server Error
    res.status(400).json({ error: error.message || "Failed to deliver SMS" });
  }
});

/* The `app.post("/decrypt-sso",async (req: Request, res: Response) => { ... })` route is used to
decrypt session details using ssoKey. */
app.post("/decrypt-sso", async (req: Request, res: Response) => {
  const { key } = req.body || {}
  if (!key) {
    return res.status(400).send("Please send valid key")
  }
  try {
    const data = ghl.decryptSSOData(key)
    res.send(data)
  } catch (error) {
    res.status(400).send("Invalid Key")
    console.log(error)
  }
})

/*`app.get("/", function (req, res) {
  res.sendFile(path + "index.html");
});` sets up a route for the root URL ("/") of the server.  This is
 used to serve the main HTML file of a web application. */
app.get("/", function (req, res) {
  res.sendFile(path + "index.html");
});

/*`app.listen(port, () => {
  console.log(`GHL app listening on port `);
});` is starting the Express server and making it listen on the specified port. */
app.listen(port, () => {
  console.log(`GHL app listening on port ${port}`);
});
