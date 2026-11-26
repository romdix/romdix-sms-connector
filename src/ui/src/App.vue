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
          <p class="subtitle">Romdix SMS integration for GoHighLevel</p>
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

        <!-- Open inside CRM notice (no manual sub-account switch page) -->
        <section v-if="!locationId && !ssoError" class="card center-card">
          <p class="card-title">Open inside your CRM</p>
          <p class="muted">Please open this app from inside your GoHighLevel sub-account.</p>
        </section>

        <template v-else-if="locationId">
          <!-- Section 1: Romdix SMS Connection -->
          <section class="card">
            <div class="card-head">
              <div>
                <h2>1. Romdix SMS Connection</h2>
                <p class="muted">Outbound SMS routes through your connected Romdix SMS account.</p>
              </div>
              <button v-if="providers.length === 0" @click="openModal()" class="btn btn-primary">
                + Connect Romdix SMS
              </button>
            </div>

            <div class="card-body">
              <div v-if="providers.length === 0" class="empty-box">
                <p class="empty-title">No Romdix SMS account connected</p>
                <p class="muted">
                  Click <strong>+ Connect Romdix SMS</strong> and enter your API Key, then test and save.
                </p>
              </div>

              <div v-else class="conn-list">
                <div v-for="provider in providers" :key="provider.id" class="conn-item">
                  <div class="conn-top">
                    <div class="conn-title-row">
                      <span class="conn-name">{{ provider.name || 'Romdix SMS' }}</span>
                      <span class="badge badge-default">Active</span>
                    </div>

                    <div class="conn-actions">
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

          <!-- Section 2: 2-Way Webhook (Collapsed by default) -->
          <section v-if="inboundKey" class="card">
            <button type="button" class="accordion-btn" @click="showWebhook = !showWebhook">
              <span>2. 2-Way Webhook</span>
              <span class="muted">{{ showWebhook ? 'Hide' : 'Show' }}</span>
            </button>

            <div v-if="showWebhook" class="accordion-body">
              <p class="muted" style="margin: 12px 0;">
                Add this URL in Romdix SMS under <strong>Developer → Webhooks → New Webhook</strong> to receive replies and delivery updates.
              </p>

              <div class="copy-row">
                <code class="url-box">{{ webhookUrl }}</code>
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
                <li>In Romdix SMS, open <strong>Developer → API Keys → New Key</strong>, enable <strong>Account</strong> and <strong>SMS</strong> permissions, and copy the key.</li>
                <li>Click <strong>+ Connect Romdix SMS</strong> above, enter your API Key, click <strong>Test Connection</strong>, and save.</li>
                <li>Open <strong>2. 2-Way Webhook</strong> above, copy the URL, open Romdix SMS → <strong>Developer → Webhooks → New Webhook</strong>, paste the URL, and select <code>sms.received</code>, <code>sms.sent</code>, <code>sms.delivered</code>, and <code>sms.failed</code>.</li>
              </ol>
            </div>
          </section>

          <!-- Footer -->
          <footer v-if="providers.length > 0" class="footer">
            <button type="button" @click="disconnect" class="footer-btn footer-danger">
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
            <h2>{{ editingProviderId ? 'Edit Romdix SMS Connection' : 'Connect Romdix SMS' }}</h2>
            <p class="muted">Enter your Romdix SMS API key.</p>
          </div>
          <button type="button" @click="closeModal" class="close-btn" aria-label="Close">&times;</button>
        </div>

        <div class="modal-body">
          <div class="field">
            <label>Name <span class="opt">(Optional)</span></label>
            <input v-model="modalSettings.name" type="text" placeholder="e.g. Romdix SMS" />
          </div>

          <div class="field">
            <label>Romdix SMS API Key</label>
            <input
              v-model="modalSettings.config.zenderApiKey"
              type="password"
              autocomplete="off"
              :placeholder="secretPlaceholder('zenderApiKey', 'Paste Bearer API Key from Romdix SMS')"
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
                  :placeholder="secretPlaceholder('zenderWebhookSecret', 'From Romdix SMS → Webhooks')"
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
      sessionToken: null,
      ssoError: null,
      inboundKey: null,
      copiedWebhook: false,
      showWebhook: false,
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
    webhookUrl() {
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
      return 'Automatic (Romdix SMS default)';
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
        this.providers = (data.providers || []).filter((p) => p.type === 'zender').slice(0, 1);
        this.defaultProviderId = this.providers[0]?.id || '';
        this.inboundKey = data.inboundKey || null;
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
      if (!this.editingProviderId && this.providers.length >= 1) {
        this.modalError = true;
        this.modalMessage = 'Only one Romdix SMS connection is allowed.';
        return;
      }
      const hasApiKey = this.modalSettings.config.zenderApiKey || this.hasSavedSecret('zenderApiKey');
      if (!hasApiKey) {
        this.modalError = true;
        this.modalMessage = 'Romdix SMS API Key is required.';
        return;
      }

      this.saving = true;
      this.modalMessage = '';

      const payload = JSON.parse(JSON.stringify(this.modalSettings));
      payload.type = 'zender';
      if (!payload.name || !payload.name.trim()) {
        payload.name = 'Romdix SMS';
      }

      if (this.editingProviderId) {
        const index = this.providers.findIndex((p) => p.id === this.editingProviderId);
        if (index !== -1) {
          this.providers.splice(index, 1, payload);
        }
      } else {
        const created = { id: 'prov_' + Date.now().toString(36), ...payload };
        this.providers = [created];
        this.defaultProviderId = created.id;
      }

      try {
        await this.persistState();
        await this.loadSettings();
        this.closeModal();
        this.message = 'Romdix SMS connection saved.';
        this.error = false;
      } catch (e) {
        this.modalMessage = `Save failed: ${e.message}`;
        this.modalError = true;
      } finally {
        this.saving = false;
      }
    },
    async deleteProvider(id) {
      if (!confirm('Remove this Romdix SMS connection?')) return;
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
      const url = this.webhookUrl;
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
      if (!confirm('Disconnect this sub-account? Saved Romdix SMS credentials will be deleted.')) return;
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
  background: #f1f5f9;
  color: #111827;
  font-size: 15px;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

#app {
  padding: 30px 16px 48px;
}

.shell {
  max-width: 800px;
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
  padding-bottom: 18px;
  border-bottom: 1.5px solid #cbd5e1;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #111827;
}

h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #111827;
}

.subtitle {
  margin: 5px 0 0;
  font-size: 15px;
  color: #4b5563;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 3px 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot-active { background: #16a34a; }
.dot-idle { background: #9ca3af; }

.loc-tag {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: #4b5563;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 7px 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.loc-tag code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #111827;
  font-size: 13px;
  font-weight: 500;
}

/* Stack & Cards */
.stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.card {
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.07), 0 1px 3px rgba(15, 23, 42, 0.05);
  overflow: hidden;
}

.card-head {
  padding: 18px 22px;
  border-bottom: 1px solid #cbd5e1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.card-head .muted {
  margin-top: 3px;
}

.card-body {
  padding: 20px 22px;
}

.center-card {
  padding: 48px 22px;
  text-align: center;
}

.card-title {
  margin: 12px 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.muted {
  color: #4b5563;
  font-size: 14.5px;
  margin: 0;
  line-height: 1.55;
}

/* Connections */
.empty-box {
  border: 1.5px dashed #94a3b8;
  background: #f8fafc;
  border-radius: 10px;
  padding: 26px 20px;
  text-align: center;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 6px;
}

.conn-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.conn-item {
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  padding: 18px;
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
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
  gap: 9px;
}

.conn-name {
  font-size: 16.5px;
  font-weight: 600;
  color: #111827;
}

.badge {
  font-size: 12.5px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #374151;
  border: 1px solid #cbd5e1;
}

.badge-default {
  background: #ecfdf5;
  color: #065f46;
  border-color: #6ee7b7;
}

.conn-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 18px;
  padding-top: 14px;
  border-top: 1px solid #e2e8f0;
}

@media (max-width: 560px) {
  .meta-grid { grid-template-columns: 1fr; }
}

.meta-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.meta-label {
  font-size: 13px;
  color: #6b7280;
}

.meta-val {
  font-size: 14.5px;
  font-weight: 500;
  color: #111827;
  word-break: break-all;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13.5px;
}

.inline-status {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
}
.status-ok { background: #ecfdf5; color: #065f46; border: 1px solid #6ee7b7; }
.status-err { background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; }

/* Webhook */
.copy-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
  flex-wrap: wrap;
}

.url-box {
  flex: 1;
  min-width: 240px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13.5px;
  color: #111827;
  word-break: break-all;
  display: flex;
  align-items: center;
}

.copy-btn {
  min-width: 104px;
}

.events-row {
  margin-top: 14px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.events-label {
  font-size: 14px;
  color: #4b5563;
  margin-right: 2px;
}

.event-tag {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #1f2937;
}

/* Accordion */
.accordion-btn {
  width: 100%;
  background: transparent;
  border: none;
  padding: 16px 22px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  cursor: pointer;
}
.accordion-btn:hover { background: #f8fafc; }

.accordion-body {
  padding: 4px 22px 20px;
  border-top: 1px solid #cbd5e1;
}

.guide-body {
  padding: 6px 22px 20px;
  border-top: 1px solid #cbd5e1;
}

.guide-list {
  margin: 14px 0 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 14.5px;
  line-height: 1.6;
  color: #374151;
}
.guide-list strong { color: #111827; }
.guide-list code {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 13px;
  color: #111827;
}

/* Footer */
.footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 4px 2px 0;
}

.footer-btn {
  background: none;
  border: none;
  padding: 4px 0;
  font-size: 14px;
  color: #4b5563;
  cursor: pointer;
}
.footer-btn:hover { color: #111827; text-decoration: underline; }
.footer-danger:hover { color: #dc2626; }

/* Buttons */
.btn {
  cursor: pointer;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  padding: 9px 16px;
  border: 1px solid transparent;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
  transition: background-color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-sm { padding: 6px 12px; font-size: 13.5px; }

.btn-primary {
  background: #111827;
  color: #ffffff;
}
.btn-primary:hover:not(:disabled) { background: #1f2937; }

.btn-secondary {
  background: #ffffff;
  border-color: #94a3b8;
  color: #1f2937;
}
.btn-secondary:hover:not(:disabled) { background: #f8fafc; border-color: #64748b; }

.btn-danger {
  background: #ffffff;
  border-color: #fca5a5;
  color: #dc2626;
}
.btn-danger:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #ef4444;
}

/* Alerts */
.alert {
  padding: 13px 16px;
  border-radius: 10px;
  font-size: 14.5px;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.alert-success { background: #ecfdf5; color: #065f46; border: 1px solid #6ee7b7; }
.alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; }
.alert-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
}

/* Spinner */
.spinner {
  width: 26px;
  height: 26px;
  margin: 0 auto;
  border: 2.5px solid #cbd5e1;
  border-top-color: #111827;
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
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
}
.opt { font-weight: 400; color: #6b7280; }

input {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid #94a3b8;
  border-radius: 8px;
  font-size: 14.5px;
  color: #111827;
  background: #ffffff;
}
input:focus {
  outline: none;
  border-color: #111827;
  box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.1);
}

.adv-wrap { margin-top: 6px; }
.adv-btn {
  background: none;
  border: none;
  padding: 4px 0;
  color: #374151;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.adv-btn:hover { color: #111827; text-decoration: underline; }

.adv-panel {
  margin-top: 12px;
  padding: 16px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
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
  margin: 12px 0 0;
  font-size: 13.5px;
  color: #4b5563;
  line-height: 1.5;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}

.modal {
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  width: 100%;
  max-width: 500px;
  border-radius: 14px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.24);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-head {
  padding: 18px 22px;
  border-bottom: 1px solid #cbd5e1;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.modal-head h2 {
  margin: 0 0 3px;
  font-size: 18px;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  line-height: 1;
  color: #6b7280;
  cursor: pointer;
}
.close-btn:hover { color: #111827; }

.modal-body {
  padding: 20px 22px;
  max-height: 68vh;
  overflow-y: auto;
}

.modal-foot {
  padding: 14px 22px;
  border-top: 1px solid #cbd5e1;
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
