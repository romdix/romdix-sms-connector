<template>
  <div id="app">
    <div class="shell">
      <!-- Top Header -->
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div class="title-row">
              <h1>Romdix SMS Connector</h1>
              <span class="env-pill">Zender</span>
            </div>
            <p class="subtitle">Two-way SMS &amp; live delivery tracking connected to your Zender gateway</p>
          </div>
        </div>

        <div class="topbar-actions" v-if="!loading && locationId">
          <button @click="openModal()" class="btn btn-primary">+ Add Zender</button>
          <button v-if="providers.length > 0" @click="disconnect" class="btn btn-ghost-danger">Disconnect</button>
        </div>
      </header>

      <!-- Loading -->
      <div v-if="loading" class="card loading-card">
        <div class="spinner"></div>
        <p class="loading-title">Connecting to sub-account…</p>
        <p v-if="loadingTime > 2" class="muted">Still verifying CRM session…</p>
      </div>

      <!-- Main Body -->
      <main v-else class="stack">
        <div v-if="ssoError" class="alert alert-error">
          <strong>Authentication Notice:</strong> {{ ssoError }}
        </div>

        <!-- Manual Location Fallback -->
        <section v-if="!locationId" class="card">
          <div class="alert alert-warning" style="margin-bottom: 16px;">
            Could not automatically detect the CRM Location ID. Enter it below to load settings.
          </div>
          <div class="field-group">
            <label>CRM Location ID</label>
            <div class="inline-form">
              <input v-model="manualIdInput" type="text" placeholder="e.g. Rh3O9aC398g336hh4Ljx" @keyup.enter="useManualId" />
              <button @click="useManualId" class="btn btn-primary">Load Settings</button>
            </div>
          </div>
        </section>

        <template v-else>
          <!-- Context Strip -->
          <div class="context-bar">
            <div class="context-chip">
              <span class="dot dot-online"></span>
              <span>Sub-account:</span>
              <code>{{ locationId }}</code>
              <button @click="resetLocation" class="link-inline">Switch</button>
            </div>
            <span class="context-meta" v-if="providers.length > 0">
              {{ providers.length }} {{ providers.length === 1 ? 'connection' : 'connections' }} configured
            </span>
          </div>

          <!-- Global Toast -->
          <div v-if="message" :class="['alert', error ? 'alert-error' : 'alert-success']">
            {{ message }}
          </div>

          <!-- Empty State -->
          <section v-if="providers.length === 0" class="card empty-card">
            <div class="empty-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>
            <h2>Connect your Zender Gateway</h2>
            <p class="muted">
              Link your Zender URL and API key so every SMS from this CRM sub-account sends through Zender with real-time replies and delivery receipts.
            </p>
            <button @click="openModal()" class="btn btn-primary">+ Connect Zender</button>
          </section>

          <!-- Connections List -->
          <section v-else class="connections-grid">
            <article
              v-for="provider in providers"
              :key="provider.id"
              :class="['card connection-card', { 'is-default': defaultProviderId === provider.id }]"
            >
              <div class="conn-main">
                <div class="conn-head">
                  <div class="conn-title-wrap">
                    <span class="conn-name">{{ provider.name || 'Zender Gateway' }}</span>
                    <span v-if="defaultProviderId === provider.id" class="pill pill-green">Default Active</span>
                    <span v-else class="pill pill-slate">Standby</span>
                  </div>
                  <div class="conn-actions">
                    <button
                      v-if="defaultProviderId !== provider.id"
                      @click="setDefaultProvider(provider.id)"
                      :disabled="saving"
                      class="btn btn-sm btn-outline"
                    >
                      Set Default
                    </button>
                    <button @click="editProvider(provider)" class="btn btn-sm btn-outline">Edit</button>
                    <button @click="deleteProvider(provider.id)" class="btn btn-sm btn-ghost-danger" title="Remove connection">Delete</button>
                  </div>
                </div>

                <div class="conn-meta">
                  <span class="meta-item">
                    <strong>Site:</strong> {{ provider.config?.baseUrl || 'https://sms.romdix.com' }}
                  </span>
                  <span class="meta-item">
                    <strong>Webhook Auth:</strong>
                    {{ hasConfigSecret(provider, 'zenderWebhookSecret') ? 'HMAC Secret + URL Key' : 'URL Key' }}
                  </span>
                  <span v-if="provider.config?.zenderSimId" class="meta-item">
                    <strong>SIM ID:</strong> {{ provider.config.zenderSimId }}
                  </span>
                  <span v-if="provider.config?.zenderSenderId" class="meta-item">
                    <strong>Sender ID:</strong> {{ provider.config.zenderSenderId }}
                  </span>
                </div>
              </div>
            </article>
          </section>

          <!-- Two-Way Webhook Card -->
          <section v-if="inboundKey" class="card webhook-card">
            <div class="card-header-row">
              <div>
                <h2>Zender 2-Way Webhook</h2>
                <p class="muted">
                  Paste this URL in Zender under <strong>Developer → Webhooks → New Webhook</strong> and select
                  <code>sms.received</code>, <code>sms.sent</code>, <code>sms.delivered</code>, and <code>sms.failed</code>.
                </p>
              </div>
            </div>
            <div class="copy-row">
              <code class="webhook-url">{{ zenderWebhookUrl }}</code>
              <button @click="copyWebhookUrl" class="btn btn-outline copy-btn">
                {{ copiedWebhook ? 'Copied!' : 'Copy URL' }}
              </button>
            </div>
          </section>

          <!-- Setup Guide Accordion -->
          <section class="card guide-card">
            <button type="button" class="guide-toggle" @click="showHelp = !showHelp">
              <span>Quick Setup Guide (3 Steps)</span>
              <span class="chevron">{{ showHelp ? '▲' : '▼' }}</span>
            </button>
            <div v-if="showHelp" class="guide-steps">
              <div class="step-item">
                <span class="step-num">1</span>
                <div>
                  <strong>Create an API Key in Zender</strong>
                  <p>Open Zender → <strong>Developer → API Keys → New Key</strong>, tick <strong>Account</strong> and <strong>SMS</strong> permissions, and copy the key.</p>
                </div>
              </div>
              <div class="step-item">
                <span class="step-num">2</span>
                <div>
                  <strong>Connect &amp; Test here</strong>
                  <p>Click <strong>+ Add Zender</strong> above, enter your Zender URL and API key, run <strong>Test Connection</strong>, and save.</p>
                </div>
              </div>
              <div class="step-item">
                <span class="step-num">3</span>
                <div>
                  <strong>Enable Inbound &amp; Delivery Status</strong>
                  <p>Add the <strong>Zender 2-Way Webhook</strong> URL shown above in Zender (<strong>Developer → Webhooks</strong>) and tick <code>sms.received</code>, <code>sms.sent</code>, <code>sms.delivered</code>, and <code>sms.failed</code>. Optionally paste the Signing Secret into the connection's Advanced Options.</p>
                </div>
              </div>
            </div>
          </section>
        </template>
      </main>
    </div>

    <!-- Add / Edit Zender Modal -->
    <div v-if="showModal" class="modal-backdrop" @click.self="closeModal">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h2>{{ editingProviderId ? 'Edit Zender Connection' : 'Connect Zender Gateway' }}</h2>
            <p class="modal-subtitle">Enter your Zender workspace URL and API key.</p>
          </div>
          <button @click="closeModal" class="icon-close" aria-label="Close">&times;</button>
        </div>

        <div class="modal-body">
          <div class="field-group">
            <label>Connection Name <span class="opt">(Optional)</span></label>
            <input v-model="modalSettings.name" type="text" placeholder="e.g. Romdix Zender" />
          </div>

          <div class="field-group">
            <label>Zender Site URL</label>
            <input v-model="modalSettings.config.baseUrl" type="url" placeholder="https://sms.romdix.com" />
          </div>

          <div class="field-group">
            <label>Zender API Key</label>
            <input
              v-model="modalSettings.config.zenderApiKey"
              type="password"
              autocomplete="off"
              :placeholder="secretPlaceholder('zenderApiKey', 'Paste Bearer API key from Zender')"
            />
          </div>

          <div class="advanced-wrap">
            <button type="button" class="link-inline" @click="showAdvanced = !showAdvanced">
              {{ showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options (Webhook Secret / Routing IDs)' }}
            </button>

            <div v-if="showAdvanced" class="advanced-box">
              <div class="field-group">
                <label>Webhook Signing Secret <span class="opt">(Optional)</span></label>
                <input
                  v-model="modalSettings.config.zenderWebhookSecret"
                  type="password"
                  autocomplete="off"
                  :placeholder="secretPlaceholder('zenderWebhookSecret', 'From Zender -> Developer -> Webhooks')"
                />
              </div>

              <div class="two-col">
                <div class="field-group">
                  <label>Zender SIM ID <span class="opt">(Optional)</span></label>
                  <input v-model="modalSettings.config.zenderSimId" type="text" placeholder="Auto (leave blank)" />
                </div>
                <div class="field-group">
                  <label>Zender Sender ID <span class="opt">(Optional)</span></label>
                  <input v-model="modalSettings.config.zenderSenderId" type="text" placeholder="Auto (leave blank)" />
                </div>
              </div>
              <p class="field-hint">
                Leave SIM ID and Sender ID blank so Zender uses its configured routing rules. Only enter numeric IDs if you want to pin a specific SIM or default provider sender.
              </p>
            </div>
          </div>

          <div v-if="modalMessage" :class="['alert', modalError ? 'alert-error' : 'alert-success']" style="margin-top: 14px;">
            {{ modalMessage }}
          </div>
        </div>

        <div class="modal-footer">
          <button @click="testConnection" :disabled="testing || saving" class="btn btn-outline">
            {{ testing ? 'Testing…' : 'Test Connection' }}
          </button>
          <button @click="saveProvider" :disabled="saving || testing" class="btn btn-primary">
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
        this.message = 'Default Zender connection updated.';
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
      await this.persistState();
      this.message = 'Connection removed.';
      this.error = false;
    },
    copyWebhookUrl() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(this.zenderWebhookUrl).then(() => {
          this.copiedWebhook = true;
          setTimeout(() => {
            this.copiedWebhook = false;
          }, 2000);
        });
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
        this.message = 'Disconnected. Credentials deleted.';
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
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --text: #0f172a;
  --muted: #64748b;
  --border: #e2e8f0;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --success-bg: #ecfdf5;
  --success-text: #065f46;
  --success-border: #a7f3d0;
  --danger: #dc2626;
  --danger-bg: #fef2f2;
  --warning-bg: #fffbeb;
  --warning-text: #92400e;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

#app {
  padding: 28px 16px 48px;
}

.shell {
  max-width: 820px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.topbar {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-mark {
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: linear-gradient(135deg, #2563eb, #1e40af);
  color: #fff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

h1 {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.subtitle {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--muted);
}

.env-pill {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px 24px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.context-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 4px;
}

.context-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 12px;
}

.context-chip code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text);
  font-size: 12px;
}

.context-meta {
  font-size: 12.5px;
  color: var(--muted);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot-online { background: #10b981; }

.connections-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.connection-card {
  transition: border-color 0.15s ease;
}

.connection-card.is-default {
  border-color: #86efac;
  background: linear-gradient(to right, #f0fdf4 0%, #ffffff 42%);
}

.conn-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.conn-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.conn-name {
  font-size: 16px;
  font-weight: 600;
}

.conn-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conn-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
  font-size: 13px;
  color: var(--muted);
}

.conn-meta strong {
  color: var(--text);
  font-weight: 500;
}

.pill {
  font-size: 11.5px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
}
.pill-green {
  background: #dcfce7;
  color: #166534;
}
.pill-slate {
  background: #f1f5f9;
  color: #475569;
}

.empty-card {
  text-align: center;
  padding: 40px 24px;
}

.empty-icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 14px;
  border-radius: 14px;
  background: #eff6ff;
  color: var(--primary);
  display: grid;
  place-items: center;
}

.empty-card p {
  max-width: 480px;
  margin: 8px auto 20px;
  font-size: 14px;
  line-height: 1.55;
}

.webhook-card h2 {
  margin-bottom: 6px;
}

.copy-row {
  margin-top: 14px;
  display: flex;
  gap: 10px;
  align-items: stretch;
  flex-wrap: wrap;
}

.webhook-url {
  flex: 1;
  min-width: 240px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text);
  word-break: break-all;
}

.guide-card {
  padding: 0;
  overflow: hidden;
}

.guide-toggle {
  width: 100%;
  background: transparent;
  border: none;
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}

.guide-toggle:hover {
  background: #f8fafc;
}

.chevron {
  font-size: 11px;
  color: var(--muted);
}

.guide-steps {
  padding: 4px 24px 20px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.step-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding-top: 12px;
}

.step-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #eff6ff;
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.step-item p {
  margin: 4px 0 0;
  font-size: 13.5px;
  color: var(--muted);
  line-height: 1.5;
}

.loading-card {
  text-align: center;
  padding: 44px 24px;
}

.loading-title {
  margin: 14px 0 4px;
  font-weight: 600;
}

.spinner {
  width: 28px;
  height: 28px;
  margin: 0 auto;
  border: 3px solid #e2e8f0;
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.btn {
  cursor: pointer;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 600;
  padding: 9px 15px;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-sm {
  padding: 6px 11px;
  font-size: 12.5px;
}

.btn-primary {
  background: var(--primary);
  color: #fff;
}
.btn-primary:hover:not(:disabled) { background: var(--primary-hover); }

.btn-outline {
  background: #fff;
  border-color: var(--border);
  color: var(--text);
}
.btn-outline:hover:not(:disabled) { background: #f8fafc; }

.btn-ghost-danger {
  background: #fff;
  border-color: #fecaca;
  color: var(--danger);
}
.btn-ghost-danger:hover:not(:disabled) { background: var(--danger-bg); }

.link-inline {
  background: none;
  border: none;
  padding: 0;
  color: var(--primary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.link-inline:hover { text-decoration: underline; }

.alert {
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13.5px;
  border: 1px solid transparent;
}
.alert-success { background: var(--success-bg); color: var(--success-text); border-color: var(--success-border); }
.alert-error { background: var(--danger-bg); color: #991b1b; border-color: #fecaca; }
.alert-warning { background: var(--warning-bg); color: var(--warning-text); border-color: #fde68a; }

.muted {
  color: var(--muted);
  font-size: 13.5px;
  margin: 0;
}

.field-group {
  margin-bottom: 16px;
}
.field-group:last-child { margin-bottom: 0; }
.field-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}
.opt {
  font-weight: 400;
  color: var(--muted);
}

.field-group input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text);
  background: #fff;
}
.field-group input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.inline-form {
  display: flex;
  gap: 10px;
}
.inline-form input { flex: 1; }

.advanced-wrap {
  margin-top: 6px;
}
.advanced-box {
  margin-top: 12px;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.field-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}
.modal {
  background: #fff;
  width: 100%;
  max-width: 510px;
  border-radius: 16px;
  box-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.25);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.modal-subtitle {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--muted);
}
.icon-close {
  background: none;
  border: none;
  font-size: 22px;
  line-height: 1;
  color: var(--muted);
  cursor: pointer;
  padding: 2px 6px;
}
.icon-close:hover { color: var(--text); }

.modal-body {
  padding: 20px 22px;
  max-height: 68vh;
  overflow-y: auto;
}
.modal-footer {
  padding: 14px 22px;
  border-top: 1px solid var(--border);
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
