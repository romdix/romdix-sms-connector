# Romdix SMS Connector for GoHighLevel

A GoHighLevel Marketplace SMS connector app supporting multiple SMS providers (Icombd, Reve SMS). Configured through an embedded Settings UI inside GoHighLevel sub-accounts.

## Table of Contents

- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deploying on Coolify](#deploying-on-coolify)
- [Architecture](#architecture)

---

## Environment Variables

All variables below must be set in Coolify's **Environment Variables** section (or in a `.env` file for local development). None of them have safe defaults — the app will not function correctly without them.

| Variable | Required | Description |
|---|---|---|
| `GHL_APP_CLIENT_ID` | ✅ Yes | GoHighLevel App Client ID |
| `GHL_APP_CLIENT_SECRET` | ✅ Yes | GoHighLevel App Client Secret |
| `GHL_APP_SSO_KEY` | ✅ Yes | GoHighLevel App SSO Key |
| `GHL_API_DOMAIN` | ✅ Yes | Always set to `https://services.leadconnectorhq.com` |
| `JWT_SECRET` | ✅ Yes | A private random key for signing session tokens |
| `PORT` | Optional | Port the server listens on (defaults to `3000`) |

---

### How to Obtain Each Variable

#### `GHL_APP_CLIENT_ID` and `GHL_APP_CLIENT_SECRET`

1. Go to **GoHighLevel Developer Portal**: [https://marketplace.gohighlevel.com/](https://marketplace.gohighlevel.com/)
2. Log in → Click **My Apps** → Select your app (or create a new one).
3. Navigate to the **App Settings** tab.
4. You will find your **Client ID** and **Client Secret** listed there.

> ⚠️ **Never share your Client Secret publicly or commit it to Git.**

---

#### `GHL_APP_SSO_KEY`

1. In the same GHL Developer Portal app page, look for the **SSO** section or **Custom Menus** section.
2. Your app's **SSO Key** is listed there. It is used to decrypt the identity token sent by GoHighLevel when a user opens your app inside the GHL iframe.

---

#### `GHL_API_DOMAIN`

This is a static value. Always set it to:
```
GHL_API_DOMAIN=https://services.leadconnectorhq.com
```

---

#### `JWT_SECRET`

This is a private secret used to sign user session tokens after the GHL SSO exchange. **Generate this yourself** — do not use an online generator for security reasons.

**Generating a secure key locally (recommended):**

Run the following command in your terminal (requires Node.js):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

It will output a 64-character hex string like:
```
a3f2c1d4e5b6789...
```
Copy and paste that as your `JWT_SECRET`.

> 🔒 **Keep this secret private.** If someone obtains this key, they can forge authentication tokens.

---

## Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/dimaxerp-dev/Romdix-SMS-Connector.git
   cd Romdix-SMS-Connector
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create your `.env` file:**
   ```bash
   cp .env .env.local
   ```
   Fill in all the required variables described above.

4. **Run the development server:**
   ```bash
   npm run dev
   ```
   The server starts at `http://localhost:3000`.

---

## Deploying on Coolify

1. **Connect your GitHub repository** to Coolify and create a new service pointing to this repo.

2. **Set Environment Variables** in the Coolify dashboard:
   ```
   GHL_APP_CLIENT_ID=your_client_id
   GHL_APP_CLIENT_SECRET=your_client_secret
   GHL_APP_SSO_KEY=your_sso_key
   GHL_API_DOMAIN=https://services.leadconnectorhq.com
   JWT_SECRET=your_generated_64_char_hex
   PORT=3000
   ```

3. **Persistent Storage (SQLite):**  
   The Dockerfile already declares `/app/data` as a Docker `VOLUME`. Coolify will automatically create a named volume for it — **no manual volume configuration is required**.  
   The SQLite database (`connector.db`) lives in this volume and will survive container restarts and redeployments.

4. **Set the Redirect URI** in your GHL app to:
   ```
   https://your-coolify-domain.com/authorize-handler
   ```

5. **Deploy** — Coolify will build the Docker image and start the container automatically.

---

## Architecture

```
GHL Sub-Account (iframe)
  └─► https://your-domain.com/?ssoToken=<encrypted>
         │
         ▼
    [App.vue] ──POST /api/auth/sso──► [index.ts]
                                          │ Decrypts SSO with GHL_APP_SSO_KEY
                                          │ Signs session JWT with JWT_SECRET
                                          ◄─── { sessionToken, locationId }
         │
         ▼
    Subsequent API calls (GET/POST /api/settings)
    include: Authorization: Bearer <sessionToken>
         │
         ▼
    [authenticateRequest middleware]
    Verifies JWT → attaches locationId to request
         │
         ▼
    [storage.ts → SQLite (AES-encrypted)]
    Persisted in Docker VOLUME at /app/data/connector.db
```

---

## License

MIT License
