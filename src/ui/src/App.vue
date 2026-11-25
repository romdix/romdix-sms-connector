<template>
  <div id="app" :class="['theme-root', darkMode ? 'theme-dark' : 'theme-light']">
    <div class="shell">
      <!-- High-Contrast Hero Header -->
      <header class="hero">
        <div class="hero-left">
          <div class="hero-logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div class="hero-title-row">
              <h1>Romdix SMS Connector</h1>
              <span v-if="!loading && locationId" :class="['status-badge', providers.length > 0 ? 'status-ok' : 'status-warn']">
                <span class="status-dot"></span>
                {{ providers.length > 0 ? 'Connected to Zender' : 'Setup Required' }}
              </span>
            </div>
            <p class="hero-sub">Send &amp; receive SMS in GoHighLevel through your Zender gateway</p>
          </div>
        </div>

        <div class="hero-right">
          <span v-if="locationId" class="loc-pill" :title="'Sub-account ID: ' + locationId">
            ID: <code>{{ locationId }}</code>
          </span>
          <button
            type="button"
            class="theme-btn"
            @click="toggleTheme"
            :title="darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
          >
            {{ darkMode ? '☀ Light' : '☾ Dark' }}
          </button>
        </div>
      </header>

      <!-- Loading -->
      <div v-if="loading" class="panel loading-panel">
        <div class="spinner"></div>
        <p class="loading-title">Connecting to GoHighLevel sub-account…</p>
        <p v-if="loadingTime > 2" class="text-muted">Verifying your CRM session…</p>
      </div>

      <!-- Content -->
      <main v-else class="content-stack">
        <!-- Auth Notice -->
        <div v-if="ssoError" class="banner banner-error">
          <strong>Session issue:</strong> {{ ssoError }}
        </div>

        <!-- Global Feedback Banner -->
        <div v-if="message" :class="['banner', error ? 'banner-error' : 'banner-success']">
          <span>{{ message }}</span>
          <button type="button" class="banner-close" @click="message = ''" aria-label="Dismiss">&times;</button>
        </div>

        <!-- Manual Location Fallback (only when opened outside GHL iframe) -->
        <section v-if="!locationId" class="panel">
          <div class="panel-head">
            <div class="step-badge step-blue">!</div>
            <div>
              <h2>Enter Sub-Account ID</h2>
              <p class="text-muted">Open this page inside GoHighLevel for automatic login, or enter a Location ID below.</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="inline-row">
              <input v-model="manualIdInput" type="text" placeholder="e.g. Rh3O9aC398g336hh4Ljx" @keyup.enter="useManualId" />
              <button @click="useManualId" class="btn btn-primary">Load</button>
            </div>
          </div>
        </section>

        <template v-else>
          <!-- STEP 1: ZENDER CONNECTION -->
          <section class="panel panel-accent-blue">
            <div class="panel-head">
              <div class="panel-head-left">
                <div class="step-badge step-blue">1</div>
                <div>
                  <h2>Zender Gateway Connection</h2>
                  <p class="text-muted">Where outbound SMS from this GoHighLevel sub-account is sent.</p>
                </div>
              </div>
              <button @click="openModal()" class="btn btn-primary">
                {{ providers.length > 0 ? '+ Add Another' : '+ Connect Zender' }}
              </button>
            </div>

            <div class="panel-body">
              <!-- Empty State -->
              <div v-if="providers.length === 0" class="empty-box">
                <div class="empty-title">No Zender account connected yet</div>
                <p class="text-muted">
                  Click <strong>+ Connect Zender</strong> above, enter your Zender URL (<code>https://sms.romdix.com</code>) and API Key, then test and save.
                </p>
              </div>

              <!-- Connected Accounts -->
              <div v-else class="conn-list">
                <div
                  v-for="provider in providers"
                  :key="provider.id"
                  :class="['conn-card', { 'conn-active': defaultProviderId === provider.id }]"
                >
                  <div class="conn-top">
                    <div class="conn-identity">
                      <span class="conn-title">{{ provider.name || 'Zender Gateway' }}</span>
                      <span v-if="defaultProviderId === provider.id" class="tag tag-green">Active Default</span>
                      <span v-else class="tag tag-neutral">Standby</span>
                    </div>
                    <div class="conn-btns">
                      <button
                        v-if="defaultProviderId !== provider.id"
                        @click="setDefaultProvider(provider.id)"
                        :disabled="saving"
                        class="btn btn-sm btn-secondary"
                      >
                        Make Default
                      </button>
                      <button
                        @click="testSavedProvider(provider)"
                        :disabled="testingProviderId === provider.id"
                        class="btn btn-sm btn-secondary"
                      >
                        {{ testingProviderId === provider.id ? 'Testing…' : 'Test' }}
                      </button>
                      <button @click="editProvider(provider)" class="btn btn-sm btn-secondary">Edit</button>
                      <button @click="deleteProvider(provider.id)" class="btn btn-sm btn-danger-outline">Delete</button>
                    </div>
                  </div>

                  <div class="info-grid">
                    <div class="info-cell">
                      <span class="info-label">Zender Site URL</span>
                      <span class="info-value mono">{{ provider.config?.baseUrl || 'https://sms.romdix.com' }}</span>
                    </div>
                    <div class="info-cell">
                      <span class="info-label">API Key</span>
                      <span class="info-value">
                        <span v-if="hasConfigSecret(provider, 'zenderApiKey')" class="ok-text">● Saved (Encrypted)</span>
                        <span v-else class="warn-text">● Not set</span>
                      </span>
                    </div>
                    <div class="info-cell">
                      <span class="info-label">SMS Routing</span>
                      <span class="info-value">{{ routingSummary(provider) }}</span>
                    </div>
                    <div class="info-cell">
                      <span class="info-label">Webhook Verification</span>
                      <span class="info-value">
                        {{ hasConfigSecret(provider, 'zenderWebhookSecret') ? 'URL Key + Signing Secret' : 'URL Key' }}
                      </span>
                    </div>
                  </div>

                  <div
                    v-if="cardTestStatus[provider.id]"
                    :class="['card-feedback', cardTestStatus[provider.id].ok ? 'feedback-ok' : 'feedback-err']"
                  >
                    {{ cardTestStatus[provider.id].text }}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- STEP 2: 2-WAY WEBHOOK -->
          <section v-if="inboundKey" class="panel panel-accent-indigo">
            <div class="panel-head">
              <div class="panel-head-left">
                <div class="step-badge step-indigo">2</div>
                <div>
                  <h2>2-Way Replies &amp; Delivery Status</h2>
                  <p class="text-muted">Add this webhook inside Zender so customer replies and delivery reports appear in GoHighLevel.</p>
                </div>
              </div>
            </div>

            <div class="panel-body">
              <label class="section-label">Your Zender Webhook URL</label>
              <div class="webhook-bar">
                <code class="webhook-code">{{ zenderWebhookUrl }}</code>
                <button type="button" @click="copyWebhookUrl" class="btn btn-primary copy-btn">
                  {{ copiedWebhook ? '✓ Copied!' : 'Copy URL' }}
                </button>
              </div>

              <div class="events-box">
                <span class="events-title">In Zender → Developer → Webhooks → New Webhook, tick these 4 events:</span>
                <div class="event-chips">
                  <span class="event-chip"><code>sms.received</code> <em>Replies</em></span>
                  <span class="event-chip"><code>sms.sent</code> <em>Sent</em></span>
                  <span class="event-chip"><code>sms.delivered</code> <em>Delivered</em></span>
                  <span class="event-chip"><code>sms.failed</code> <em>Failed</em></span>
                </div>
              </div>
            </div>
          </section>

          <!-- STEP 3: QUICK CHECKLIST & ACCOUNT CONTROLS -->
          <section class="panel panel-compact">
            <button type="button" class="accordion-btn" @click="showHelp = !showHelp">
              <span class="accordion-left">
                <span class="step-badge step-slate">?</span>
                <span><strong>Setup Checklist</strong> — How to create your Zender API Key &amp; Webhook</span>
              </span>
              <span class="accordion-arrow">{{ showHelp ? 'Hide ▲' : 'Show ▼' }}</span>
            </button>

            <div v-if="showHelp" class="checklist-body">
              <ol class="checklist">
                <li>
                  <strong>Get your Zender API Key:</strong>
                  In Zender, open <strong>Developer → API Keys → New Key</strong>, tick <strong>Account</strong> and <strong>SMS</strong> permissions, click Create, and copy the key.
                </li>
                <li>
                  <strong>Connect above (Step 1):</strong>
                  Click <strong>+ Connect Zender</strong>, paste your Zender URL and API Key, click <strong>Test Connection</strong>, then <strong>Save Connection</strong>.
                </li>
                <li>
                  <strong>Connect the Webhook (Step 2):</strong>
                  Copy the webhook URL above, open Zender → <strong>Developer → Webhooks → New Webhook</strong>, paste the URL, tick the 4 SMS events, and save.
                </li>
              </ol>
            </div>
          </section>

          <!-- Footer Danger / Reset Row -->
          <footer class="footer-bar">
            <button type="button" @click="resetLocation" class="footer-link">Switch Sub-Account</button>
            <button v-if="providers.length > 0" type="button" @click="disconnect" class="footer-danger">
              Disconnect Sub-Account
            </button>
          </footer>
        </template>
      </main>
    </div>

    <!-- Add / Edit Zender Modal -->
    <div v-if="showModal" class="modal-backdrop" @click.self="closeModal">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <h2>{{ editingProviderId ? 'Edit Zender Connection' : 'Connect Zender Gateway' }}</h2>
            <p class="text-muted">Only the Site URL and API Key are required.</p>
          </div>
          <button type="button" @click="closeModal" class="modal-close" aria-label="Close">&times;</button>
        </div>

        <div class="modal-body">
          <div class="field">
            <label>Connection Name <span class="opt">(Optional)</span></label>
            <input v-model="modalSettings.name" type="text" placeholder="e.g. Romdix Zender" />
          </div>

          <div class="field">
            <label>Zender Site URL <span class="req">*</span></label>
            <input v-model="modalSettings.config.baseUrl" type="url" placeholder="https://sms.romdix.com" />
          </div>

          <div class="field">
            <label>Zender API Key <span class="req">*</span></label>
            <input
              v-model="modalSettings.config.zenderApiKey"
              type="password"
              autocomplete="off"
              :placeholder="secretPlaceholder('zenderApiKey', 'Paste Bearer API Key from Zender')"
            />
          </div>

          <div class="adv-section">
            <button type="button" class="adv-toggle" @click="showAdvanced = !showAdvanced">
              <span>{{ showAdvanced ? '▾ Hide Optional Settings' : '▸ Optional Settings (Webhook Secret, SIM ID, Sender ID)' }}</span>
            </button>

            <div v-if="showAdvanced" class="adv-card">
              <div class="field">
                <label>Webhook Signing Secret <span class="opt">(Optional)</span></label>
                <input
                  v-model="modalSettings.config.zenderWebhookSecret"
                  type="password"
                  autocomplete="off"
                  :placeholder="secretPlaceholder('zenderWebhookSecret', 'From Zender → Webhooks')"
                />
              </div>

              <div class="two-col">
                <div class="field">
                  <label>Zender SIM ID <span class="opt">(Optional)</span></label>
                  <input v-model="modalSettings.config.zenderSimId" type="text" placeholder="Leave blank for auto" />
                </div>
                <div class="field">
                  <label>Zender Sender ID <span class="opt">(Optional)</span></label>
                  <input v-model="modalSettings.config.zenderSenderId" type="text" placeholder="Leave blank for auto" />
                </div>
              </div>
              <p class="hint">
                Leave SIM ID and Sender ID empty unless you want to pin a specific numeric ID from Zender.
              </p>
            </div>
          </div>

          <div v-if="modalMessage" :class="['banner', modalError ? 'banner-error' : 'banner-success']" style="margin-top: 14px;">
            {{ modalMessage }}
          </div>
        </div>

        <div class="modal-foot">
          <button type="button" @click="testConnection" :disabled="testing || saving" class="btn btn-secondary">
            {{ testing ? 'Testing…' : 'Test Connection' }}
          </button>
          <button type="button" @click="saveProvider" :disabled="saving || testing" class="btn btn-primary">
            {{ saving ? 'Saving…' : 'Save Connection' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'App',
  data() {
    let savedDark = false;
    try {
      savedDark = localStorage.getItem('romdix_sms_theme') === 'dark';
    } catch { /* ignore iframe storage restrictions */ }

    return {
      darkMode: savedDark,
      locationId: null,
      manualIdInput: '',
      sessionToken: null,
      ssoError: null,
      inboundKey: null,
      copiedWebhook: false,
      showHelp: false,
      showAdvanced: false,

      providers: [],
      defaultProviderId: '',

      showModal: false,
      editingProviderId: null,
      modalSettings: {
        type: 'zender',
        name: '',
        config: {}
      },

      loading: true,
      loadingTime: 0,
      saving: false,
      testing: false,
      testingProviderId: null,
      cardTestStatus: {},
      message: '',
      error: false,
      modalMessage: '',
      modalError: false
    };
  },
  computed: {
    zenderWebhookUrl() {
      return `${window.location.origin}/api/inbound/zender?key=${this.inboundKey}`;
    }
  },
  mounted() {
    this.startLoadingTimer();
    this.initContext();
  },
  methods: {
    toggleTheme() {
      this.darkMode = !this.darkMode;
      try {
        localStorage.setItem('romdix_sms_theme', this.darkMode ? 'dark' : 'light');
      } catch { /* ignore */ }
    },
    routingSummary(provider) {
      const sim = provider?.config?.zenderSimId;
      const sender = provider?.config?.zenderSenderId;
      if (sim && sender) return `SIM #${sim} / Sender #${sender}`;
      if (sim) return `Android SIM #${sim}`;
      if (sender) return `Provider Sender #${sender}`;
      return 'Automatic (Zender default)';
    },
    startLoadingTimer() {
      setInterval(() => {
        if (this.loading) this.loadingTime++;
      }, 1000);
    },
    requestGhlUserData(timeoutMs = 5000) {
      if (window.parent === window) return Promise.resolve(null);
      return new Promise((resolve) => {
        let done = false;
        const finish = (val) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          resolve(val);
        };
        const onMessage = (event) => {
          const data = event.data;
          if (!data || typeof data !== 'object') return;
          if (data.message === 'REQUEST_USER_DATA_RESPONSE' && data.payload) {
            finish(data.payload);
          }
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        window.addEventListener('message', onMessage);
        try {
          window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
        } catch {
          finish(null);
        }
      });
    },
    async exchangeSsoToken(ssoToken) {
      const res = await fetch('/api/auth/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssoToken })
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.sessionToken = data.sessionToken;
      if (data.locationId) this.locationId = data.locationId;
      return true;
    },
    async ensureSession() {
      if (this.sessionToken) return true;
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      let ssoToken = urlParams.get('ssoToken') || hashParams.get('ssoToken');
      if (!ssoToken) {
        ssoToken = await this.requestGhlUserData();
      }
      if (!ssoToken) return false;
      return await this.exchangeSsoToken(ssoToken);
    },
    async initContext() {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));

        const hasUrlToken = !!(urlParams.get('ssoToken') || hashParams.get('ssoToken'));
        const authenticated = await this.ensureSession();
        if (authenticated && this.locationId) {
          await this.loadSettings();
          return;
        }
        if (hasUrlToken) {
          this.ssoError = 'Authentication failed. Please re-open this page from inside your CRM.';
          return;
        }

        const getValidParam = (name) => {
          const val = urlParams.get(name) || hashParams.get(name);
          if (val && !val.includes('{{') && !val.includes('}}')) return val;
          return null;
        };
        let detectedId = getValidParam('locationId') || getValidParam('location_id');
        if (!detectedId && document.referrer) {
          const match = document.referrer.match(/\/location\/([a-zA-Z0-9]+)/);
          if (match && match[1]) detectedId = match[1];
        }
        this.locationId = detectedId;
      } catch (e) {
        console.error('Init Error:', e);
      } finally {
        this.loading = false;
      }
    },
    async useManualId() {
      if (!this.manualIdInput) return;
      this.locationId = this.manualIdInput.trim();
      this.loading = true;
      await this.loadSettings();
      this.loading = false;
    },
    resetLocation() {
      this.locationId = null;
      this.providers = [];
      this.defaultProviderId = '';
      this.message = '';
      this.cardTestStatus = {};
    },
    async loadSettings() {
      try {
        const headers = this.sessionToken ? { Authorization: `Bearer ${this.sessionToken}` } : {};
        const res = await fetch('/api/settings', { headers });
        if (res.status === 401) {
          this.ssoError = 'CRM login could not be verified. Open this page from inside your CRM and try again.';
          this.providers = [];
          this.defaultProviderId = '';
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.providers = (data.providers || []).filter((p) => p.type === 'zender');
        this.defaultProviderId = data.defaultProviderId || '';
        this.inboundKey = data.inboundKey || null;
        if (this.providers.length > 0 && !this.providers.some((p) => p.id === this.defaultProviderId)) {
          this.defaultProviderId = this.providers[0].id;
        }
      } catch (e) {
        this.ssoError = `Could not load settings: ${e.message}`;
      }
    },
    openModal() {
      this.editingProviderId = null;
      this.modalSettings = {
        type: 'zender',
        name: '',
        config: {
          baseUrl: 'https://sms.romdix.com',
          zenderApiKey: '',
          zenderWebhookSecret: '',
          zenderSenderId: '',
          zenderSimId: ''
        }
      };
      this.showAdvanced = false;
      this.modalMessage = '';
      this.modalError = false;
      this.showModal = true;
    },
    editProvider(provider) {
      this.editingProviderId = provider.id;
      const cloned = JSON.parse(JSON.stringify(provider));
      cloned.type = 'zender';
      cloned.config = {
        baseUrl: 'https://sms.romdix.com',
        zenderApiKey: '',
        zenderWebhookSecret: '',
        zenderSenderId: '',
        zenderSimId: '',
        ...(cloned.config || {})
      };
      this.modalSettings = cloned;
      this.showAdvanced = !!(
        cloned.config.zenderSenderId ||
        cloned.config.zenderSimId ||
        this.hasConfigSecret(cloned, 'zenderWebhookSecret')
      );
      this.modalMessage = '';
      this.modalError = false;
      this.showModal = true;
    },
    closeModal() {
      this.showModal = false;
    },
    hasConfigSecret(provider, field) {
      return Array.isArray(provider?.config?.secretsSet) && provider.config.secretsSet.includes(field);
    },
    hasSavedSecret(field) {
      return this.hasConfigSecret(this.modalSettings, field);
    },
    secretPlaceholder(field, fallback) {
      return this.hasSavedSecret(field) ? 'Saved — leave blank to keep' : fallback;
    },
    async saveProvider() {
      const hasApiKey = this.modalSettings.config.zenderApiKey || this.hasSavedSecret('zenderApiKey');
      if (!this.modalSettings.config.baseUrl || !hasApiKey) {
        this.modalError = true;
        this.modalMessage = 'Zender Site URL and Zender API Key are required.';
        return;
      }

      this.saving = true;
      this.modalMessage = '';

      const payload = JSON.parse(JSON.stringify(this.modalSettings));
      payload.type = 'zender';
      if (!payload.name || !payload.name.trim()) {
        payload.name = 'Zender Gateway';
      }

      if (this.editingProviderId) {
        const index = this.providers.findIndex((p) => p.id === this.editingProviderId);
        if (index !== -1) {
          this.providers.splice(index, 1, payload);
        }
      } else {
        const created = { id: 'prov_' + Date.now().toString(36), ...payload };
        this.providers.push(created);
        if (this.providers.length === 1) {
          this.defaultProviderId = created.id;
        }
      }

      try {
        await this.persistState();
        await this.loadSettings();
        this.closeModal();
        this.message = 'Zender connection saved successfully.';
        this.error = false;
      } catch (e) {
        this.modalMessage = `Save failed: ${e.message}`;
        this.modalError = true;
      } finally {
        this.saving = false;
      }
    },
    async setDefaultProvider(id) {
      this.defaultProviderId = id;
      this.saving = true;
      try {
        await this.persistState();
        this.message = 'Active default Zender connection updated.';
        this.error = false;
      } finally {
        this.saving = false;
      }
    },
    async deleteProvider(id) {
      if (!confirm('Remove this Zender connection?')) return;
      this.providers = this.providers.filter((p) => p.id !== id);
      if (this.defaultProviderId === id) {
        this.defaultProviderId = this.providers[0]?.id || '';
      }
      delete this.cardTestStatus[id];
      await this.persistState();
      this.message = 'Connection removed.';
      this.error = false;
    },
    copyWebhookUrl() {
      const url = this.zenderWebhookUrl;
      const done = () => {
        this.copiedWebhook = true;
        setTimeout(() => {
          this.copiedWebhook = false;
        }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(() => this.fallbackCopy(url, done));
      } else {
        this.fallbackCopy(url, done);
      }
    },
    fallbackCopy(text, onSuccess) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        onSuccess();
      } finally {
        document.body.removeChild(ta);
      }
    },
    async disconnect() {
      if (!confirm('Disconnect this sub-account? Saved Zender credentials will be deleted.')) return;
      try {
        const headers = {};
        if (this.sessionToken) headers.Authorization = `Bearer ${this.sessionToken}`;
        const res = await fetch('/api/settings', { method: 'DELETE', headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.providers = [];
        this.defaultProviderId = '';
        this.cardTestStatus = {};
        this.message = 'Disconnected. Saved credentials deleted.';
        this.error = false;
      } catch (e) {
        this.message = `Disconnect failed: ${e.message}`;
        this.error = true;
      }
    },
    async persistState() {
      try {
        const body = JSON.stringify({
          defaultProviderId: this.defaultProviderId,
          providers: this.providers
        });
        const send = () => {
          const headers = { 'Content-Type': 'application/json' };
          if (this.sessionToken) headers.Authorization = `Bearer ${this.sessionToken}`;
          return fetch('/api/settings', { method: 'POST', headers, body });
        };

        let res = await send();
        if (res.status === 401) {
          this.sessionToken = null;
          if (await this.ensureSession()) {
            res = await send();
          }
        }
        if (!res.ok) {
          let detail = '';
          try {
            const data = await res.json();
            detail = data.error || '';
          } catch { /* ignore */ }
          if (res.status === 401) {
            detail = 'CRM session expired. Re-open this page inside GoHighLevel and try again.';
            this.ssoError = detail;
          }
          throw new Error(detail || `HTTP ${res.status}`);
        }
      } catch (e) {
        this.message = `Error saving: ${e.message}`;
        this.error = true;
        throw e;
      }
    },
    async testSavedProvider(provider) {
      this.testingProviderId = provider.id;
      this.cardTestStatus = { ...this.cardTestStatus, [provider.id]: null };
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (this.sessionToken) headers.Authorization = `Bearer ${this.sessionToken}`;
        const res = await fetch('/api/test-connection', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            providerType: 'zender',
            providerId: provider.id,
            ...(provider.config || {})
          })
        });
        const data = await res.json();
        if (data.success) {
          this.cardTestStatus = { ...this.cardTestStatus, [provider.id]: { ok: true, text: '✓ Connection verified with Zender.' } };
        } else {
          this.cardTestStatus = { ...this.cardTestStatus, [provider.id]: { ok: false, text: `✕ ${data.error || 'Connection test failed.'}` } };
        }
      } catch (e) {
        this.cardTestStatus = { ...this.cardTestStatus, [provider.id]: { ok: false, text: `✕ ${e.message}` } };
      } finally {
        this.testingProviderId = null;
      }
    },
    async testConnection() {
      this.testing = true;
      this.modalMessage = '';
      this.modalError = false;
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (this.sessionToken) headers.Authorization = `Bearer ${this.sessionToken}`;
        const res = await fetch('/api/test-connection', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            providerType: 'zender',
            providerId: this.editingProviderId || null,
            ...this.modalSettings.config
          })
        });
        const data = await res.json();
        if (data.success) {
          this.modalMessage = data.message || 'Connection Successful!';
        } else {
          throw new Error(data.error || 'Connection test failed');
        }
      } catch (e) {
        this.modalMessage = e.message;
        this.modalError = true;
      } finally {
        this.testing = false;
      }
    }
  }
};
</script>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.theme-light {
  --page-bg: #e9eef5;
  --panel-bg: #ffffff;
  --panel-subtle: #f8fafc;
  --panel-border: #cbd5e1;
  --divider: #e2e8f0;
  --text: #0f172a;
  --text-muted: #475569;
  --input-bg: #ffffff;
  --input-border: #cbd5e1;
  --code-bg: #0f172a;
  --code-text: #f1f5f9;
  --chip-bg: #f1f5f9;
  --chip-border: #cbd5e1;
  --active-bg: #f0fdf4;
  --active-border: #4ade80;
  --shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
}

.theme-dark {
  --page-bg: #0b1120;
  --panel-bg: #111827;
  --panel-subtle: #1e293b;
  --panel-border: #334155;
  --divider: #1f2937;
  --text: #f8fafc;
  --text-muted: #94a3b8;
  --input-bg: #0f172a;
  --input-border: #334155;
  --code-bg: #020617;
  --code-text: #e2e8f0;
  --chip-bg: #1e293b;
  --chip-border: #334155;
  --active-bg: #052e16;
  --active-border: #22c55e;
  --shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.theme-root {
  min-height: 100vh;
  background: var(--page-bg);
  color: var(--text);
  padding: 24px 16px 48px;
  transition: background 0.15s ease, color 0.15s ease;
}

.shell {
  max-width: 840px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* Dark Slate Hero Header — strong contrast in both Light & Dark modes */
.hero {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  color: #f8fafc;
  border-radius: 16px;
  padding: 22px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.18);
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.hero-logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #2563eb;
  color: #fff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.45);
}

.hero-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.hero h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #ffffff;
}

.hero-sub {
  margin: 4px 0 0;
  font-size: 13.5px;
  color: #cbd5e1;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.status-ok {
  background: rgba(16, 185, 129, 0.18);
  color: #6ee7b7;
  border: 1px solid rgba(52, 211, 153, 0.4);
}
.status-ok .status-dot { background: #34d399; }

.status-warn {
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
  border: 1px solid rgba(251, 191, 36, 0.45);
}
.status-warn .status-dot { background: #fbbf24; }

.hero-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.loc-pill {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #cbd5e1;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
}

.loc-pill code {
  color: #ffffff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.theme-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #f8fafc;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.theme-btn:hover { background: rgba(255, 255, 255, 0.18); }

/* Main Panels */
.content-stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.panel {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.panel-accent-blue {
  border-top: 4px solid #2563eb;
}

.panel-accent-indigo {
  border-top: 4px solid #6366f1;
}

.panel-head {
  padding: 18px 22px;
  border-bottom: 1px solid var(--divider);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.panel-head-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-head h2 {
  margin: 0;
  font-size: 16.5px;
  font-weight: 700;
  color: var(--text);
}

.panel-head .text-muted {
  margin-top: 2px;
}

.panel-body {
  padding: 20px 22px;
}

.step-badge {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.step-blue { background: #dbeafe; color: #1d4ed8; }
.step-indigo { background: #e0e7ff; color: #4338ca; }
.step-slate { background: #e2e8f0; color: #334155; }

.theme-dark .step-blue { background: rgba(37, 99, 235, 0.25); color: #93c5fd; }
.theme-dark .step-indigo { background: rgba(99, 102, 241, 0.25); color: #a5b4fc; }
.theme-dark .step-slate { background: #334155; color: #e2e8f0; }

.text-muted {
  color: var(--text-muted);
  font-size: 13.5px;
  margin: 0;
  line-height: 1.5;
}

/* Connections */
.empty-box {
  background: var(--panel-subtle);
  border: 2px dashed var(--panel-border);
  border-radius: 12px;
  padding: 28px 20px;
  text-align: center;
}

.empty-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 6px;
}

.conn-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.conn-card {
  background: var(--panel-subtle);
  border: 1.5px solid var(--panel-border);
  border-radius: 12px;
  padding: 16px 18px;
}

.conn-card.conn-active {
  background: var(--active-bg);
  border-color: var(--active-border);
}

.conn-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.conn-identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.conn-title {
  font-size: 16px;
  font-weight: 700;
}

.conn-btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tag {
  font-size: 11.5px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.tag-green { background: #16a34a; color: #ffffff; }
.tag-neutral { background: #64748b; color: #ffffff; }

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 600px) {
  .info-grid { grid-template-columns: 1fr; }
}

.info-cell {
  background: var(--panel-bg);
  border: 1px solid var(--divider);
  border-radius: 9px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.info-label {
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.info-value {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}

.ok-text { color: #16a34a; }
.warn-text { color: #d97706; }

.card-feedback {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
}
.feedback-ok { background: #dcfce7; color: #166534; }
.feedback-err { background: #fee2e2; color: #991b1b; }

/* Webhook Section */
.section-label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.webhook-bar {
  display: flex;
  gap: 10px;
  align-items: stretch;
  flex-wrap: wrap;
}

.webhook-code {
  flex: 1;
  min-width: 240px;
  background: var(--code-bg);
  color: var(--code-text);
  padding: 12px 14px;
  border-radius: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.45;
  word-break: break-all;
  display: flex;
  align-items: center;
}

.copy-btn {
  min-width: 115px;
}

.events-box {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}

.events-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 10px;
}

.event-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.event-chip {
  background: var(--chip-bg);
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.event-chip code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  color: #2563eb;
}
.theme-dark .event-chip code { color: #93c5fd; }

.event-chip em {
  font-style: normal;
  color: var(--text-muted);
  font-size: 12px;
}

/* Accordion */
.panel-compact {
  padding: 0;
}

.accordion-btn {
  width: 100%;
  background: transparent;
  border: none;
  padding: 15px 22px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}
.accordion-btn:hover { background: var(--panel-subtle); }

.accordion-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.accordion-arrow {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  flex-shrink: 0;
}

.checklist-body {
  padding: 4px 22px 20px;
  border-top: 1px solid var(--divider);
}

.checklist {
  margin: 14px 0 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-muted);
}
.checklist strong { color: var(--text); }

/* Footer */
.footer-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 6px;
}

.footer-link, .footer-danger {
  background: none;
  border: none;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 0;
}
.footer-link { color: var(--text-muted); }
.footer-link:hover { color: var(--text); text-decoration: underline; }
.footer-danger { color: #dc2626; }
.footer-danger:hover { text-decoration: underline; }

/* Buttons */
.btn {
  cursor: pointer;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  padding: 9px 16px;
  border: 1px solid transparent;
  transition: all 0.14s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-sm { padding: 6px 11px; font-size: 12.5px; }

.btn-primary {
  background: #2563eb;
  color: #ffffff;
}
.btn-primary:hover:not(:disabled) { background: #1d4ed8; }

.btn-secondary {
  background: var(--panel-bg);
  border-color: var(--panel-border);
  color: var(--text);
}
.btn-secondary:hover:not(:disabled) { background: var(--panel-subtle); }

.btn-danger-outline {
  background: var(--panel-bg);
  border-color: #fca5a5;
  color: #dc2626;
}
.btn-danger-outline:hover:not(:disabled) { background: #fef2f2; }
.theme-dark .btn-danger-outline:hover:not(:disabled) { background: rgba(220, 38, 38, 0.16); }

/* Banners */
.banner {
  padding: 12px 16px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 500;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.banner-success { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
.banner-error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
.banner-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
}

/* Loading */
.loading-panel {
  padding: 48px 24px;
  text-align: center;
}
.loading-title {
  margin: 14px 0 4px;
  font-weight: 700;
}
.spinner {
  width: 30px;
  height: 30px;
  margin: 0 auto;
  border: 3px solid var(--divider);
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Inputs & Modal */
.inline-row {
  display: flex;
  gap: 10px;
}
.inline-row input { flex: 1; }

.field {
  margin-bottom: 16px;
}
.field:last-child { margin-bottom: 0; }
.field label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.req { color: #dc2626; }
.opt { font-weight: 400; color: var(--text-muted); }

input {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--input-border);
  border-radius: 9px;
  font-size: 14px;
  background: var(--input-bg);
  color: var(--text);
}
input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
}

.adv-section { margin-top: 6px; }
.adv-toggle {
  background: none;
  border: none;
  padding: 4px 0;
  color: #2563eb;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.theme-dark .adv-toggle { color: #60a5fa; }

.adv-card {
  margin-top: 10px;
  padding: 14px;
  border-radius: 10px;
  background: var(--panel-subtle);
  border: 1px solid var(--panel-border);
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 520px) {
  .two-col { grid-template-columns: 1fr; }
}

.hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.65);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}

.modal {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  width: 100%;
  max-width: 520px;
  border-radius: 16px;
  box-shadow: 0 24px 50px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-head {
  padding: 18px 22px;
  border-bottom: 1px solid var(--divider);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.modal-head h2 {
  margin: 0 0 3px;
  font-size: 17px;
  font-weight: 700;
}
.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
}
.modal-close:hover { color: var(--text); }

.modal-body {
  padding: 20px 22px;
  max-height: 68vh;
  overflow-y: auto;
}

.modal-foot {
  padding: 14px 22px;
  border-top: 1px solid var(--divider);
  background: var(--panel-subtle);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
