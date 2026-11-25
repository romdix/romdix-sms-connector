<template>
  <div id="app">
    <div class="shell">
      <!-- Minimal Header -->
      <header class="header">
        <div>
          <div class="title-row">
            <h1>Romdix SMS Connector</h1>
            <span v-if="!loading && locationId" class="status-pill">
              <span :class="['dot', providers.length > 0 ? 'dot-active' : 'dot-idle']"></span>
              {{ providers.length > 0 ? 'Connected' : 'Not configured' }}
            </span>
          </div>
          <p class="subtitle">Zender SMS gateway integration for GoHighLevel</p>
        </div>

        <div v-if="locationId" class="loc-tag">
          <span>Sub-account</span>
          <code>{{ locationId }}</code>
        </div>
      </header>

      <!-- Loading -->
      <div v-if="loading" class="card center-card">
        <div class="spinner"></div>
        <p class="card-title">Loading sub-account…</p>
        <p v-if="loadingTime > 2" class="muted">Verifying CRM session…</p>
      </div>

      <!-- Main -->
      <main v-else class="stack">
        <div v-if="ssoError" class="alert alert-error">
          <strong>Session error:</strong> {{ ssoError }}
        </div>

        <div v-if="message" :class="['alert', error ? 'alert-error' : 'alert-success']">
          <span>{{ message }}</span>
          <button type="button" class="alert-close" @click="message = ''" aria-label="Dismiss">&times;</button>
        </div>

        <!-- Manual Location Fallback -->
        <section v-if="!locationId" class="card">
          <div class="card-head">
            <div>
              <h2>Sub-Account ID</h2>
              <p class="muted">Open this page inside GoHighLevel, or enter a Location ID below.</p>
            </div>
          </div>
          <div class="card-body">
            <div class="inline-row">
              <input v-model="manualIdInput" type="text" placeholder="e.g. Rh3O9aC398g336hh4Ljx" @keyup.enter="useManualId" />
              <button @click="useManualId" class="btn btn-primary">Load</button>
            </div>
          </div>
        </section>

        <template v-else>
          <!-- Section 1: Zender Connection -->
          <section class="card">
            <div class="card-head">
              <div>
                <h2>1. Zender Connection</h2>
                <p class="muted">Outbound SMS routes through your active Zender workspace.</p>
              </div>
              <button @click="openModal()" class="btn btn-primary">
                {{ providers.length > 0 ? '+ Add Connection' : '+ Connect Zender' }}
              </button>
            </div>

            <div class="card-body">
              <div v-if="providers.length === 0" class="empty-box">
                <p class="empty-title">No Zender workspace connected</p>
                <p class="muted">
                  Click <strong>+ Connect Zender</strong>, enter your Zender URL (<code>https://sms.romdix.com</code>) and API Key, then test and save.
                </p>
              </div>

              <div v-else class="conn-list">
                <div v-for="provider in providers" :key="provider.id" class="conn-item">
                  <div class="conn-top">
                    <div class="conn-title-row">
                      <span class="conn-name">{{ provider.name || 'Zender Gateway' }}</span>
                      <span v-if="defaultProviderId === provider.id" class="badge badge-default">Default</span>
                      <span v-else class="badge">Standby</span>
                    </div>

                    <div class="conn-actions">
                      <button
                        v-if="defaultProviderId !== provider.id"
                        @click="setDefaultProvider(provider.id)"
                        :disabled="saving"
                        class="btn btn-sm btn-secondary"
                      >
                        Set Default
                      </button>
                      <button
                        @click="testSavedProvider(provider)"
                        :disabled="testingProviderId === provider.id"
                        class="btn btn-sm btn-secondary"
                      >
                        {{ testingProviderId === provider.id ? 'Testing…' : 'Test' }}
                      </button>
                      <button @click="editProvider(provider)" class="btn btn-sm btn-secondary">Edit</button>
                      <button @click="deleteProvider(provider.id)" class="btn btn-sm btn-danger">Delete</button>
                    </div>
                  </div>

                  <div class="meta-grid">
                    <div class="meta-cell">
                      <span class="meta-label">Site URL</span>
                      <span class="meta-val mono">{{ provider.config?.baseUrl || 'https://sms.romdix.com' }}</span>
                    </div>
                    <div class="meta-cell">
                      <span class="meta-label">API Key</span>
                      <span class="meta-val">
                        {{ hasConfigSecret(provider, 'zenderApiKey') ? 'Saved (Encrypted)' : 'Not set' }}
                      </span>
                    </div>
                    <div class="meta-cell">
                      <span class="meta-label">Routing</span>
                      <span class="meta-val">{{ routingSummary(provider) }}</span>
                    </div>
                    <div class="meta-cell">
                      <span class="meta-label">Webhook Auth</span>
                      <span class="meta-val">
                        {{ hasConfigSecret(provider, 'zenderWebhookSecret') ? 'URL Key + Signing Secret' : 'URL Key' }}
                      </span>
                    </div>
                  </div>

                  <div
                    v-if="cardTestStatus[provider.id]"
                    :class="['inline-status', cardTestStatus[provider.id].ok ? 'status-ok' : 'status-err']"
                  >
                    {{ cardTestStatus[provider.id].text }}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- Section 2: Webhook -->
          <section v-if="inboundKey" class="card">
            <div class="card-head">
              <div>
                <h2>2. 2-Way Webhook</h2>
                <p class="muted">
                  Add this URL in Zender under <strong>Developer → Webhooks → New Webhook</strong> to receive replies and delivery updates.
                </p>
              </div>
            </div>

            <div class="card-body">
              <div class="copy-row">
                <code class="url-box">{{ zenderWebhookUrl }}</code>
                <button type="button" @click="copyWebhookUrl" class="btn btn-secondary copy-btn">
                  {{ copiedWebhook ? 'Copied' : 'Copy URL' }}
                </button>
              </div>

              <div class="events-row">
                <span class="events-label">Events to enable:</span>
                <code class="event-tag">sms.received</code>
                <code class="event-tag">sms.sent</code>
                <code class="event-tag">sms.delivered</code>
                <code class="event-tag">sms.failed</code>
              </div>
            </div>
          </section>

          <!-- Section 3: Setup Guide -->
          <section class="card">
            <button type="button" class="accordion-btn" @click="showHelp = !showHelp">
              <span>Setup guide</span>
              <span class="muted">{{ showHelp ? 'Hide' : 'Show' }}</span>
            </button>
            <div v-if="showHelp" class="guide-body">
              <ol class="guide-list">
                <li>In Zender, open <strong>Developer → API Keys → New Key</strong>, enable <strong>Account</strong> and <strong>SMS</strong> permissions, and copy the key.</li>
                <li>Click <strong>+ Connect Zender</strong> above, enter your Zender URL and API Key, click <strong>Test Connection</strong>, and save.</li>
                <li>Copy the webhook URL from Section 2, open Zender → <strong>Developer → Webhooks → New Webhook</strong>, paste the URL, and select <code>sms.received</code>, <code>sms.sent</code>, <code>sms.delivered</code>, and <code>sms.failed</code>.</li>
              </ol>
            </div>
          </section>

          <!-- Footer -->
          <footer class="footer">
            <button type="button" @click="resetLocation" class="footer-btn">Switch sub-account</button>
            <button v-if="providers.length > 0" type="button" @click="disconnect" class="footer-btn footer-danger">
              Disconnect sub-account
            </button>
          </footer>
        </template>
      </main>
    </div>

    <!-- Add / Edit Modal -->
    <div v-if="showModal" class="modal-backdrop" @click.self="closeModal">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <h2>{{ editingProviderId ? 'Edit Zender Connection' : 'Connect Zender' }}</h2>
            <p class="muted">Enter your Zender workspace URL and API key.</p>
          </div>
          <button type="button" @click="closeModal" class="close-btn" aria-label="Close">&times;</button>
        </div>

        <div class="modal-body">
          <div class="field">
            <label>Name <span class="opt">(Optional)</span></label>
            <input v-model="modalSettings.name" type="text" placeholder="e.g. Romdix Zender" />
          </div>

          <div class="field">
            <label>Zender Site URL</label>
            <input v-model="modalSettings.config.baseUrl" type="url" placeholder="https://sms.romdix.com" />
          </div>

          <div class="field">
            <label>Zender API Key</label>
            <input
              v-model="modalSettings.config.zenderApiKey"
              type="password"
              autocomplete="off"
              :placeholder="secretPlaceholder('zenderApiKey', 'Paste Bearer API Key from Zender')"
            />
          </div>

          <div class="adv-wrap">
            <button type="button" class="adv-btn" @click="showAdvanced = !showAdvanced">
              {{ showAdvanced ? 'Hide optional settings' : 'Show optional settings (Webhook secret, SIM ID, Sender ID)' }}
            </button>

            <div v-if="showAdvanced" class="adv-panel">
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
                  <label>SIM ID <span class="opt">(Optional)</span></label>
                  <input v-model="modalSettings.config.zenderSimId" type="text" placeholder="Auto" />
                </div>
                <div class="field">
                  <label>Sender ID <span class="opt">(Optional)</span></label>
                  <input v-model="modalSettings.config.zenderSenderId" type="text" placeholder="Auto" />
                </div>
              </div>
              <p class="hint">
                Leave SIM ID and Sender ID blank for automatic routing. Only enter numeric IDs if you want to pin a specific SIM or default provider sender.
              </p>
            </div>
          </div>

          <div v-if="modalMessage" :class="['alert', modalError ? 'alert-error' : 'alert-success']" style="margin-top: 14px;">
            <span>{{ modalMessage }}</span>
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
    return {
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
        this.message = 'Zender connection saved.';
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
        this.message = 'Default connection updated.';
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
          this.cardTestStatus = { ...this.cardTestStatus, [provider.id]: { ok: true, text: 'Connection verified.' } };
        } else {
          this.cardTestStatus = { ...this.cardTestStatus, [provider.id]: { ok: false, text: data.error || 'Connection test failed.' } };
        }
      } catch (e) {
        this.cardTestStatus = { ...this.cardTestStatus, [provider.id]: { ok: false, text: e.message } };
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
          this.modalMessage = data.message || 'Connection successful.';
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
  background: #f9fafb;
  color: #111827;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

#app {
  padding: 28px 16px 48px;
}

.shell {
  max-width: 780px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: #111827;
}

h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.subtitle {
  margin: 4px 0 0;
  font-size: 13.5px;
  color: #6b7280;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #374151;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  padding: 2px 10px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.dot-active { background: #16a34a; }
.dot-idle { background: #9ca3af; }

.loc-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 6px 10px;
}

.loc-tag code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #111827;
  font-size: 12px;
}

/* Stack & Cards */
.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03);
  overflow: hidden;
}

.card-head {
  padding: 16px 20px;
  border-bottom: 1px solid #f3f4f6;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.card-head .muted {
  margin-top: 2px;
}

.card-body {
  padding: 18px 20px;
}

.center-card {
  padding: 44px 20px;
  text-align: center;
}

.card-title {
  margin: 12px 0 4px;
  font-size: 14px;
  font-weight: 600;
}

.muted {
  color: #6b7280;
  font-size: 13px;
  margin: 0;
  line-height: 1.5;
}

/* Connections */
.empty-box {
  border: 1px dashed #d1d5db;
  background: #f9fafb;
  border-radius: 8px;
  padding: 24px 18px;
  text-align: center;
}

.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 4px;
}

.conn-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.conn-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  background: #ffffff;
}

.conn-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.conn-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conn-name {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.badge {
  font-size: 11.5px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #4b5563;
  border: 1px solid #e5e7eb;
}

.badge-default {
  background: #ecfdf5;
  color: #065f46;
  border-color: #a7f3d0;
}

.conn-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  padding-top: 12px;
  border-top: 1px solid #f3f4f6;
}

@media (max-width: 560px) {
  .meta-grid { grid-template-columns: 1fr; }
}

.meta-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-label {
  font-size: 11.5px;
  color: #6b7280;
}

.meta-val {
  font-size: 13px;
  font-weight: 500;
  color: #111827;
  word-break: break-all;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
}

.inline-status {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
}
.status-ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.status-err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

/* Webhook */
.copy-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
  flex-wrap: wrap;
}

.url-box {
  flex: 1;
  min-width: 240px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 7px;
  padding: 9px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  color: #111827;
  word-break: break-all;
  display: flex;
  align-items: center;
}

.copy-btn {
  min-width: 96px;
}

.events-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.events-label {
  font-size: 12.5px;
  color: #6b7280;
  margin-right: 2px;
}

.event-tag {
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #374151;
}

/* Accordion */
.accordion-btn {
  width: 100%;
  background: transparent;
  border: none;
  padding: 14px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13.5px;
  font-weight: 500;
  color: #111827;
  cursor: pointer;
}
.accordion-btn:hover { background: #f9fafb; }

.guide-body {
  padding: 4px 20px 18px;
  border-top: 1px solid #f3f4f6;
}

.guide-list {
  margin: 12px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  line-height: 1.55;
  color: #4b5563;
}
.guide-list strong { color: #111827; }
.guide-list code {
  background: #f3f4f6;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  color: #111827;
}

/* Footer */
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 2px 0;
}

.footer-btn {
  background: none;
  border: none;
  padding: 4px 0;
  font-size: 12.5px;
  color: #6b7280;
  cursor: pointer;
}
.footer-btn:hover { color: #111827; text-decoration: underline; }
.footer-danger:hover { color: #dc2626; }

/* Buttons */
.btn {
  cursor: pointer;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 14px;
  border: 1px solid transparent;
  transition: background-color 0.12s ease, border-color 0.12s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-sm { padding: 5px 10px; font-size: 12.5px; }

.btn-primary {
  background: #111827;
  color: #ffffff;
}
.btn-primary:hover:not(:disabled) { background: #1f2937; }

.btn-secondary {
  background: #ffffff;
  border-color: #d1d5db;
  color: #374151;
}
.btn-secondary:hover:not(:disabled) { background: #f9fafb; }

.btn-danger {
  background: #ffffff;
  border-color: #e5e7eb;
  color: #dc2626;
}
.btn-danger:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #fecaca;
}

/* Alerts */
.alert {
  padding: 11px 14px;
  border-radius: 8px;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.alert-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.alert-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}

/* Spinner */
.spinner {
  width: 24px;
  height: 24px;
  margin: 0 auto;
  border: 2.5px solid #e5e7eb;
  border-top-color: #111827;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Inputs & Modal */
.inline-row {
  display: flex;
  gap: 8px;
}
.inline-row input { flex: 1; }

.field {
  margin-bottom: 14px;
}
.field:last-child { margin-bottom: 0; }
.field label {
  display: block;
  margin-bottom: 5px;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}
.opt { font-weight: 400; color: #9ca3af; }

input {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid #d1d5db;
  border-radius: 7px;
  font-size: 13.5px;
  color: #111827;
  background: #ffffff;
}
input:focus {
  outline: none;
  border-color: #111827;
  box-shadow: 0 0 0 2px rgba(17, 24, 39, 0.08);
}

.adv-wrap { margin-top: 4px; }
.adv-btn {
  background: none;
  border: none;
  padding: 4px 0;
  color: #4b5563;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}
.adv-btn:hover { color: #111827; text-decoration: underline; }

.adv-panel {
  margin-top: 10px;
  padding: 14px;
  border-radius: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 520px) {
  .two-col { grid-template-columns: 1fr; }
}

.hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.45;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}

.modal {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  width: 100%;
  max-width: 480px;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(17, 24, 39, 0.16);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-head {
  padding: 16px 20px;
  border-bottom: 1px solid #f3f4f6;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.modal-head h2 {
  margin: 0 0 2px;
  font-size: 16px;
}

.close-btn {
  background: none;
  border: none;
  font-size: 22px;
  line-height: 1;
  color: #9ca3af;
  cursor: pointer;
}
.close-btn:hover { color: #111827; }

.modal-body {
  padding: 18px 20px;
  max-height: 68vh;
  overflow-y: auto;
}

.modal-foot {
  padding: 12px 20px;
  border-top: 1px solid #f3f4f6;
  background: #f9fafb;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
