import axios from 'axios';
import { SMSProvider } from './sms-provider.interface';

// Updated to v1 API based on verified endpoint (v3 returns 404)
// Using IP address as fallback for DNS resolution issues in Docker
const ICOMBD_API_URL = 'http://api.icombd.com/api/v1/campaigns/sendsms/plain';
const ICOMBD_API_URL_IP = 'http://63.142.254.221/api/v1/campaigns/sendsms/plain';
const ICOMBD_API_URL_BASE = 'https://api.icombd.com';
const ICOMBD_API_URL_BASE_IP = 'http://63.142.254.221';

export class IcombdProvider implements SMSProvider {
    async sendSMS(to: string, message: string, config: any) {
        if (!config.user || !config.pass || !config.senderId) {
            throw new Error('Icombd credentials missing (user, pass, senderId required).');
        }

        // Use URLSearchParams for application/x-www-form-urlencoded
        const params = new URLSearchParams();
        params.append('username', config.user);
        params.append('password', config.pass);
        params.append('sender', config.senderId);
        params.append('to', to);
        params.append('message', message);
        // The plain endpoint is documented with "text" in some examples and
        // "message" in others; send both so either parser accepts it.
        params.append('text', message);

        const requestConfig = {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        };

        try {
            const response = await axios.post(ICOMBD_API_URL, params, requestConfig);
            return response.data;
        } catch (error: any) {
            // If DNS resolution fails, try with IP address
            if (error.code === 'EAI_AGAIN' || error.code === 'ENOTFOUND') {
                console.log('DNS failed, retrying with IP address...');
                try {
                    const response = await axios.post(ICOMBD_API_URL_IP, params, requestConfig);
                    return response.data;
                } catch (ipError: any) {
                    console.error('Icombd API Error (IP fallback):', ipError.response?.data || ipError.message);
                    throw new Error(ipError.response?.data || 'Failed to send SMS via Icombd');
                }
            }
            console.error('Icombd API Error:', error.response?.data || error.message);
            throw new Error(error.response?.data || 'Failed to send SMS via Icombd');
        }
    }

    async testConnection(config: any): Promise<boolean> {
        if (!config.user || !config.pass || !config.senderId) {
            throw new Error('Missing credentials.');
        }

        // Trick: Send with empty "to" number.
        const params = new URLSearchParams();
        params.append('username', config.user);
        params.append('password', config.pass);
        params.append('sender', config.senderId);
        params.append('to', ""); // Empty to trigger validation
        params.append('message', "Test");

        const requestConfig = {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        };

        const attemptConnection = async (url: string) => {
            try {
                const response = await axios.post(url, params, requestConfig);
                const data = response.data;
                console.log("Test Connection Response:", data);

                const responseStr = String(data);
                if (responseStr.includes('1004') ||
                    responseStr.toLowerCase().includes('auth') ||
                    responseStr.toLowerCase().includes('invalid')) {
                    throw new Error('Authentication Failed (Invalid Username/Password/SenderID).');
                }
                return true;
            } catch (error: any) {
                console.error("Test Connection Error:", error.message);
                console.error("Test Connection Response Data:", error.response?.data);

                if (error.response?.status === 401 || error.response?.status === 403) {
                    throw new Error('Authentication Failed.');
                }

                // If we get "Number Empty" (often 400 or just text), it means we connected & authed!
                if (error.response?.status === 400 || (error.response?.data && String(error.response.data).includes('1002'))) {
                    return true;
                }

                if (error.response?.status === 404) {
                    throw new Error('API Endpoint not found (404). Contact support.');
                }

                throw error;
            }
        };

        try {
            return await attemptConnection(ICOMBD_API_URL);
        } catch (error: any) {
            // If DNS resolution fails, try with IP address
            if (error.code === 'EAI_AGAIN' || error.code === 'ENOTFOUND') {
                console.log('DNS failed, retrying with IP address...');
                return await attemptConnection(ICOMBD_API_URL_IP);
            }
            throw new Error(error.message || 'Connection check failed.');
        }
    }

    extractMessageId(result: any): string | null {
        const id = result && (result.apiMessageId || result.Message_ID || result.messageId);
        return id ? String(id) : null;
    }

    /** Docker DNS sometimes fails for api.icombd.com; retry against the IP. */
    private async getWithFallback(path: string, params: Record<string, any>) {
        try {
            return await axios.get(`${ICOMBD_API_URL_BASE}${path}`, { params, timeout: 20000 });
        } catch (error: any) {
            if (error.code === 'EAI_AGAIN' || error.code === 'ENOTFOUND') {
                console.log('DNS failed, retrying with IP address...');
                return await axios.get(`${ICOMBD_API_URL_BASE_IP}${path}`, { params, timeout: 20000 });
            }
            throw error;
        }
    }

    async getStatus(messageId: string, config: any): Promise<'sent' | 'delivered' | 'failed' | 'pending'> {
        if (!config.user || !config.pass) throw new Error('Icombd credentials missing.');
        const response = await this.getWithFallback('/api/v1/message-logs/get-report', {
            username: config.user,
            password: config.pass,
            messageId,
        });
        const entry = response.data && response.data.list && response.data.list[0];
        const status = String((entry && entry.status) || '').toUpperCase();
        // Check failures before "DELIVERED" because "UNDELIVERED" contains it.
        if (/UNDELIV|REJECT|EXPIR|FAIL/.test(status)) return 'failed';
        if (status.includes('DELIVERED')) return 'delivered';
        if (!status && String(response.data && response.data.status).toUpperCase() === 'COMPLETED' && entry && entry.status_code === 1) {
            return 'delivered';
        }
        return 'pending';
    }

    async pullInbound(config: any): Promise<Array<{ id: string; from: string; to?: string; message: string; receivedAt?: string }>> {
        if (!config.user || !config.pass) return [];
        // Do not auto-mark as read: a message is only marked processed after it
        // was successfully added to HighLevel, so a failed attempt is retried.
        const response = await this.getWithFallback('/api/v1/sms-inbox/pull', {
            username: config.user,
            password: config.pass,
            unreadOnly: false,
            limit: 100,
            autoMarkRead: false,
        });
        const messages = response.data && Array.isArray(response.data.messages) ? response.data.messages : [];
        return messages
            .filter((m: any) => m && m.message)
            .map((m: any) => ({
                id: String(m.id || m.externalId || ''),
                from: String(m.from || ''),
                to: m.to ? String(m.to) : undefined,
                message: String(m.message),
                receivedAt: m.receivedAt,
            }));
    }
}
