<template>
  <div id="app">
    <div class="container">
      <div class="header">
        <h1>SMS Providers</h1>
        <div class="header-actions">
          <button v-if="!loading && locationId" @click="openModal()" class="primary-btn add-btn">+ Add Provider</button>
          <button v-if="!loading && providers.length > 0" @click="disconnect" class="danger-btn">Disconnect</button>
        </div>
      </div>
      
      <div v-if="loading" class="loading-state">
        <p>Loading context...</p>
        <small v-if="loadingTime > 2">Taking longer than expected...</small>
      </div>

      <div v-else>
        <!-- SSO Auth Error -->
        <div v-if="ssoError" class="message error" style="margin-bottom:16px;">
          🔒 {{ ssoError }}
        </div>

        <!-- Manual Location Entry -->
        <div v-if="!locationId">
          <div class="message warning">
            Could not detect Location ID. Please enter manually.
          </div>
          <div class="form-group">
            <label>Location ID</label>
            <input v-model="manualIdInput" type="text" placeholder="loc_xxxxxxxx" />
            <button @click="useManualId" style="margin-top: 10px;">Load Settings</button>
          </div>
        </div>

        <!-- Providers List -->
        <div v-else>
           <div class="context-info">Location: {{ locationId }} <button @click="resetLocation" class="link-btn">(Change)</button></div>
           
           <div v-if="providers.length === 0" class="empty-state">
             <p>No SMS providers configured yet. Click "Add Provider" to get started.</p>
           </div>
           
           <div v-else class="provider-list">
             <table>
               <thead>
                 <tr>
                   <th>Provider</th>
                   <th>Name</th>
                   <th>Default</th>
                   <th>Actions</th>
                 </tr>
               </thead>
               <tbody>
                 <tr v-for="provider in providers" :key="provider.id" :class="{ 'is-default': defaultProviderId === provider.id }">
                   <td>
                     <span class="badge">{{ provider.type === 'icombd' ? 'Icombd' : 'Reve SMS' }}</span>
                   </td>
                   <td>{{ provider.name }}</td>
                   <td>
                     <input type="radio" :value="provider.id" v-model="defaultProviderId" @change="saveActiveState" />
                   </td>
                   <td>
                     <button @click="editProvider(provider)" class="action-btn edit" title="Edit">✏️</button>
                     <button @click="deleteProvider(provider.id)" class="action-btn delete" title="Delete">🗑️</button>
                   </td>
                 </tr>
               </tbody>
             </table>
           </div>

           <div class="actions">
             <button v-if="providers.length > 0" @click="saveActiveState" :disabled="saving" class="primary-btn save-active-btn">
               {{ saving ? 'Saving...' : 'Save Settings' }}
             </button>
           </div>
           <div v-if="message" :class="['message', error ? 'error' : 'success']">
             {{ message }}
           </div>
        </div>
      </div>
    </div>

    <!-- Add/Edit Provider Modal -->
    <div v-if="showModal" class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h2>{{ editingProviderId ? 'Edit Provider' : 'Add New Provider' }}</h2>
          <button @click="closeModal" class="close-btn">&times;</button>
        </div>
        
        <div class="modal-body">
           <div class="form-group">
            <label>SMS Provider Type</label>
            <select v-model="modalSettings.type" :disabled="editingProviderId">
                <option value="icombd">Icombd — two-way SMS (inbox must be enabled)</option>
                <option value="revesms">Reve SMS — outbound + delivery reports</option>
            </select>
            <small v-if="modalSettings.type === 'revesms'" style="display:block; margin-top:6px; color:#6b7280;">
              Reve does not return replies. Use Icombd if you need two-way conversations.
            </small>
           </div>
           
           <div class="form-group">
            <label>Name (Optional)</label>
             <input v-model="modalSettings.name" type="text" placeholder="e.g. Primary Reve Account" />
           </div>

           <!-- Icombd Fields -->
           <div v-if="modalSettings.type === 'icombd'">
               <div class="form-group">
                <label>Icombd Username</label>
                <input v-model="modalSettings.config.user" type="text" placeholder="Username" />
              </div>
              <div class="form-group">
                <label>Icombd Password</label>
                <input v-model="modalSettings.config.pass" type="password" :placeholder="secretPlaceholder('pass', 'Password')" />
              </div>
              <div class="form-group">
                <label>Sender ID</label>
                <input v-model="modalSettings.config.senderId" type="text" placeholder="Sender Name or Number" />
              </div>
           </div>

           <!-- Reve SMS Fields -->
           <div v-else-if="modalSettings.type === 'revesms'">
               <div class="form-group">
                 <label>API Key</label>
                 <input v-model="modalSettings.config.apikey" type="text" :placeholder="secretPlaceholder('apikey', 'API Key')" />
               </div>
               <div class="form-group">
                 <label>Secret Key</label>
                 <input v-model="modalSettings.config.secretkey" type="password" :placeholder="secretPlaceholder('secretkey', 'Secret Key')" />
               </div>
              <div class="form-group">
                <label>Caller ID / Sender ID <small style="font-weight:normal; color:#6b7280;">(Required for sending)</small></label>
                <input v-model="modalSettings.config.callerID" type="text" placeholder="Caller ID" />
              </div>
           </div>
           
           <div v-if="modalMessage" :class="['message', modalError ? 'error' : 'success']">
             {{ modalMessage }}
           </div>
        </div>
        
        <div class="modal-footer">
          <button @click="testConnection" :disabled="testing || saving" class="test-btn">
              {{ testing ? 'Testing...' : 'Test Connection' }}
          </button>
          <button @click="saveProvider" :disabled="saving || testing" class="primary-btn">
            {{ saving ? 'Saving...' : 'Save Provider' }}
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
      sessionToken: null,   // JWT session token from SSO exchange
      ssoError: null,       // Error message if SSO auth fails
      
      // Main state
      providers: [],
      defaultProviderId: '',
      
      // Modal state
      showModal: false,
      editingProviderId: null,
      modalSettings: {
        type: 'revesms',
        name: '',
        config: {}
      },
      
      // UI state
      loading: true,
      loadingTime: 0,
      saving: false,
      testing: false,
      message: '',
      error: false,
      modalMessage: '',
      modalError: false
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
    // Ask the GoHighLevel parent frame for the encrypted user payload.
    // Custom menu links open the page in an iframe without an ssoToken in the URL,
    // so this handshake is the only way to prove who is looking at the page.
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
        } catch (e) {
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
      if (!res.ok) {
        console.error('[Auth] SSO exchange failed:', res.status, await res.text());
        return false;
      }
      const data = await res.json();
      this.sessionToken = data.sessionToken;
      if (data.locationId) this.locationId = data.locationId;
      console.log('[Auth] SSO authenticated, locationId:', this.locationId);
      return true;
    },
    // Gets a session token from the URL token or the GHL iframe handshake.
    async ensureSession() {
      if (this.sessionToken) return true;
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      let ssoToken = urlParams.get('ssoToken') || hashParams.get('ssoToken');
      if (!ssoToken) {
        console.log('[Auth] No ssoToken in URL, asking GHL parent window...');
        ssoToken = await this.requestGhlUserData();
      }
      if (!ssoToken) return false;
      return await this.exchangeSsoToken(ssoToken);
    },
    async initContext() {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));

        // === Primary Auth Path: GHL SSO Token (URL or iframe handshake) ===
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

        // === Fallback: Manual locationId detection (for internal testing) ===
        const getValidParam = (name) => {
          const val = urlParams.get(name) || hashParams.get(name);
          if (val && !val.includes('{{') && !val.includes('}}')) return val;
          return null;
        };
        let detectedId = getValidParam('locationId') || getValidParam('location_id');
        if (!detectedId && document.referrer) {
          const referrerMatch = document.referrer.match(/\/location\/([a-zA-Z0-9]+)/);
          if (referrerMatch && referrerMatch[1]) detectedId = referrerMatch[1];
        }
        this.locationId = detectedId;
        // Note: in fallback mode, no sessionToken — manual use only.
      } catch (e) {
        console.error("Init Error:", e);
      } finally {
        this.loading = false;
      }
    },
    async useManualId() {
        if (!this.manualIdInput) return;
        this.locationId = this.manualIdInput;
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
        const headers = this.sessionToken ? { 'Authorization': `Bearer ${this.sessionToken}` } : {};
        const res = await fetch(`/api/settings`, { headers });
        if (res.status === 401) {
          this.ssoError = 'CRM login could not be verified. Open this page from inside your CRM and try again.';
          this.providers = [];
          this.defaultProviderId = '';
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.providers = data.providers || [];
        this.defaultProviderId = data.defaultProviderId || '';
        if (this.providers.length === 1 && !this.defaultProviderId) {
          this.defaultProviderId = this.providers[0].id;
        }
      } catch (e) {
        console.error("Failed to load settings", e);
        this.ssoError = `Could not load settings: ${e.message}`;
      }
    },
    
    // Modal Interaction
    openModal() {
      this.editingProviderId = null;
      this.modalSettings = {
        type: 'revesms',
        name: 'My Reve Account',
        config: {
          user: '', pass: '', senderId: '',
          apikey: '', secretkey: '', callerID: ''
        }
      };
      this.modalMessage = '';
      this.modalError = false;
      this.showModal = true;
    },
    editProvider(provider) {
      this.editingProviderId = provider.id;
      // Deep clone to avoid reactive edits before save
      this.modalSettings = JSON.parse(JSON.stringify(provider));
      this.modalMessage = '';
      this.modalError = false;
      this.showModal = true;
    },
    closeModal() {
      this.showModal = false;
    },
    
    // API Actions
    async saveProvider() {
      // Validate
      if (this.modalSettings.type === 'revesms') {
        if (!this.modalSettings.config.apikey || !this.modalSettings.config.secretkey) {
          this.modalError = true;
          this.modalMessage = "API Key and Secret Key are required.";
          return;
        }
      } else {
        if (!this.modalSettings.config.user || !this.modalSettings.config.pass) {
          this.modalError = true;
          this.modalMessage = "Username and Password are required.";
          return;
        }
      }

      this.saving = true;
      this.modalMessage = '';
      
      // Update local state
      if (this.editingProviderId) {
        const index = this.providers.findIndex(p => p.id === this.editingProviderId);
        if (index !== -1) {
          this.providers.splice(index, 1, JSON.parse(JSON.stringify(this.modalSettings)));
        }
      } else {
        const newProvider = {
          id: 'prov_' + Date.now().toString(36),
          ...JSON.parse(JSON.stringify(this.modalSettings))
        };
        this.providers.push(newProvider);
        if (this.providers.length === 1) {
          this.defaultProviderId = newProvider.id;
        }
      }

      // Persist to backend
      try {
        await this.persistState();
        this.closeModal();
        this.message = 'Provider saved successfully!';
        this.error = false;
      } catch (e) {
        // persistState already sets this.message, just show modal error too
        this.modalMessage = `Save failed: ${e.message}`;
        this.modalError = true;
      } finally {
        this.saving = false;
      }
    },
    async deleteProvider(id) {
      if (!confirm('Are you sure you want to delete this provider?')) return;
      this.providers = this.providers.filter(p => p.id !== id);
      if (this.defaultProviderId === id) {
        this.defaultProviderId = this.providers.length > 0 ? this.providers[0].id : '';
      }
      await this.persistState();
      this.message = 'Provider deleted.';
      this.error = false;
    },
    secretPlaceholder(field, fallback) {
      const saved = Array.isArray(this.modalSettings.config.secretsSet) && this.modalSettings.config.secretsSet.includes(field);
      return saved ? 'Saved — leave blank to keep' : fallback;
    },
    async disconnect() {
      if (!confirm('Disconnect this sub-account? Saved provider credentials will be deleted.')) return;
      try {
        const headers = {};
        if (this.sessionToken) headers['Authorization'] = `Bearer ${this.sessionToken}`;
        const res = await fetch('/api/settings', { method: 'DELETE', headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.providers = [];
        this.defaultProviderId = '';
        this.message = 'Disconnected. Provider credentials deleted.';
        this.error = false;
      } catch (e) {
        this.message = `Disconnect failed: ${e.message}`;
        this.error = true;
      }
    },
    async saveActiveState() {
      this.saving = true;
      await this.persistState();
      this.saving = false;
      this.message = 'Default provider updated!';
      this.error = false;
    },
    async persistState() {
      try {
        const body = JSON.stringify({
          defaultProviderId: this.defaultProviderId,
          providers: this.providers
        });

        const send = async () => {
          const headers = { 'Content-Type': 'application/json' };
          if (this.sessionToken) headers['Authorization'] = `Bearer ${this.sessionToken}`;
          return fetch('/api/settings', { method: 'POST', headers, body });
        };

        let res = await send();
        // Session token can expire (8h) or be missing — try the GHL handshake once more.
        if (res.status === 401) {
          console.log('[Auth] Save rejected with 401, re-authenticating...');
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
          } catch (e) { /* non-JSON error body */ }
          if (res.status === 401) {
            detail = 'GoHighLevel login could not be verified. Open this page from the "Romdix SMS Config" menu inside GoHighLevel and try again.';
            this.ssoError = detail;
          }
          throw new Error(detail || `HTTP ${res.status}`);
        }
      } catch (e) {
        console.error(e);
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
        // Build payload specifically for the /api/test-connection endpoint
        // Test endpoint expects { providerType: 'revesms', apikey: '...', etc }
        const testPayload = {
          providerType: this.modalSettings.type,
          providerId: this.editingProviderId || null,
          ...this.modalSettings.config
        };

        const testHeaders = { 'Content-Type': 'application/json' };
        if (this.sessionToken) testHeaders['Authorization'] = `Bearer ${this.sessionToken}`;
        const res = await fetch('/api/test-connection', {
          method: 'POST',
          headers: testHeaders,
          body: JSON.stringify(testPayload)
        });
        const data = await res.json();
        
        if (data.success) {
             this.modalMessage = data.message || 'Connection Verified!';
        } else {
             throw new Error(data.error || 'Test failed');
        }
      } catch (e) {
        this.modalMessage = `Connection Test Failed: ${e.message}`;
        this.modalError = true;
      } finally {
        this.testing = false;
      }
    }
  }
}
</script>

<style>
/* CSS Reset and Variables */
:root {
  --primary: #155eef;
  --primary-hover: #175cd3;
  --bg-color: #f9fafb;
  --card-bg: #ffffff;
  --text-main: #111827;
  --text-muted: #6b7280;
  --border: #eaecf0;
  --danger: #d92d20;
  --danger-hover: #b42318;
}

body {
  background-color: var(--bg-color);
  margin: 0;
}

#app {
  font-family: Inter, Helvetica, Arial, sans-serif;
  color: var(--text-main);
  margin-top: 40px;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
}

.container {
  background: var(--card-bg);
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

h1, h2 {
  margin: 0;
}
h1 { font-size: 24px; }
h2 { font-size: 18px; }

/* Buttons */
button {
  cursor: pointer;
  padding: 8px 16px;
  border: 1px solid var(--border);
  background: white;
  border-radius: 6px;
  font-weight: 500;
  font-size: 14px;
  transition: all 0.2s;
}
button:hover { background: #f9fafb; }
button:disabled { opacity: 0.6; cursor: not-allowed; }

.primary-btn {
  background-color: var(--primary);
  color: white;
  border: none;
}
.primary-btn:hover:not(:disabled) {
  background-color: var(--primary-hover);
}

.test-btn {
  background-color: white;
  border: 1px solid var(--border);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.danger-btn {
  background: #fff;
  border: 1px solid var(--danger);
  color: var(--danger);
}
.danger-btn:hover:not(:disabled) { background: #fef2f2; }

/* Tables */
.provider-list {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  margin-top: 20px;
  margin-bottom: 20px;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th {
  background-color: #f9fafb;
  padding: 12px 16px;
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
}
td {
  padding: 16px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
tr:last-child td { border-bottom: none; }
tr.is-default { background-color: #f0fdf4; }

.badge {
  background-color: #effaa8;
  color: #4d5b00;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.action-btn {
  background: none;
  border: none;
  padding: 4px 8px;
  font-size: 16px;
  margin-right: 4px;
}
.action-btn:hover { background: #f3f4f6; }

/* Forms */
.form-group {
  margin-bottom: 20px;
}
.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  font-size: 14px;
  color: #374151;
}
.form-group input, .form-group select {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}
.form-group input:focus, .form-group select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(21, 94, 239, 0.1);
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: white;
  width: 100%;
  max-width: 500px;
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.close-btn {
  background: none; border: none; font-size: 24px;
  color: var(--text-muted); padding: 0; line-height: 1;
}
.modal-body {
  padding: 24px;
  max-height: 60vh;
  overflow-y: auto;
}
.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  background: #f9fafb;
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
}

/* Utils */
.message {
  padding: 12px;
  border-radius: 6px;
  font-size: 14px;
  margin-top: 16px;
}
.message.success { background-color: #ecfdf5; color: #065f46; }
.message.error { background-color: #fef2f2; color: #991b1b; }
.message.warning { background-color: #fffbeb; color: #92400e; }
.empty-state {
  text-align: center;
  padding: 40px 20px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px dashed #d1d5db;
  color: var(--text-muted);
}
.context-info {
  text-align: right; font-size: 12px; color: var(--text-muted); margin-bottom: 16px;
}
.link-btn {
  background: none; border: none; color: var(--primary); padding: 0;
}
</style>
