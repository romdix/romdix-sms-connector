import axios from 'axios';
import { SMSProvider } from './sms-provider.interface';

// Primary HTTPS API
const REVESMS_API_URL = 'https://smpp.revesms.com:7790/sendtext';
// Secondary HTTP API
const REVESMS_API_URL_HTTP = 'http://smpp.revesms.com:7788/sendtext';
// IP fallback (White Level)
const REVESMS_API_URL_IP = 'http://103.177.125.106:7788/sendtext';
// Delivery status endpoint
const REVESMS_STATUS_URL = 'https://smpp.revesms.com:7790/getstatus';

export class ReveSmsProvider implements SMSProvider {
    async sendSMS(to: string, message: string, config: any) {
        if (!config.apikey || !config.secretkey || !config.callerID) {
            throw new Error('Reve SMS credentials missing (apikey, secretkey, and callerID are required for sending). Please update settings.');
        }

        // Reve SMS expects numbers without the '+' sign (e.g. 8801...)
        const cleanTo = to.replace(/[^0-9]/g, '');

        const params = {
            apikey: config.apikey,
            secretkey: config.secretkey,
            callerID: config.callerID,
            toUser: cleanTo,
            messageContent: message
        };

        const attemptSend = async (url: string) => {
            const response = await axios.get(url, { params, timeout: 10000 });
            const data = response.data;
            console.log(`Reve SMS Response from ${url}:`, data);
            
            // Reve SMS often returns HTTP 200 but includes an error payload like:
            // {"Status":"109","Text":"Invalid api key/secret key","Message_ID":""}
            if (data && typeof data === 'object') {
                const statusStr = String(data.Status);
                // Status 0 isn't documented, but usually 1** or 2** are used, let's catch clear errors
                if (data.Status && statusStr !== '0' && statusStr !== '200' && statusStr !== '202') {
                    // Usually anything not empty Message_ID or clear string indicates a problem
                    if (!data.Message_ID || data.Message_ID === "") {
                        throw new Error(`Reve SMS Error: ${data.Text || 'Unknown error'}`);
                    }
                }
            } else if (typeof data === 'string') {
                if (data.toLowerCase().includes('invalid') || data.toLowerCase().includes('error')) {
                     throw new Error(`Reve SMS Error: ${data}`);
                }
            }

            return data;
        };

        try {
            return await attemptSend(REVESMS_API_URL);
        } catch (error: any) {
            console.warn(`Primary Reve SMS endpoint failed: ${error.message}`);
            try {
                // Return fallback attempt
                return await attemptSend(REVESMS_API_URL_HTTP);
            } catch (httpError: any) {
                console.warn(`Secondary Reve SMS endpoint failed: ${httpError.message}`);
                try {
                    // Final IP fallback attempt
                    return await attemptSend(REVESMS_API_URL_IP);
                } catch (ipError: any) {
                    console.error('All Reve SMS endpoints failed.');
                    throw new Error(ipError.message || 'Failed to send SMS via Reve SMS');
                }
            }
        }
    }

    async testConnection(config: any): Promise<boolean> {
        if (!config.apikey || !config.secretkey) {
            throw new Error('Missing API Key or Secret Key.');
        }

        // Test with empty toUser to trigger a non-auth validation error
        // We use a dummy callerID if the user hasn't provided one yet
        const params = {
            apikey: config.apikey,
            secretkey: config.secretkey,
            callerID: config.callerID || 'TestSender',
            toUser: '',
            messageContent: 'Test'
        };

        const attemptConnection = async (url: string) => {
            const response = await axios.get(url, { params, timeout: 10000 });
            const data = response.data;
            console.log(`Reve SMS Test Connection Response from ${url}:`, data);

            // Parse response body correctly even if it's JSON
            const dataStr = typeof data === 'object' ? JSON.stringify(data).toLowerCase() : String(data).toLowerCase();

            // Look for authentication failure keywords in the payload
            if (dataStr.includes('invalid') || 
                dataStr.includes('unauthorized') || 
                dataStr.includes('authentication failed')) {
                throw new Error(`Authentication Failed: ${typeof data === 'object' ? data.Text : dataStr}`);
            }

            // If we didn't hit an auth error, we're successfully connected
            return true;
        };

        try {
            return await attemptConnection(REVESMS_API_URL);
        } catch (error: any) {
            console.warn(`Primary test connection failed: ${error.message}`);
            try {
                return await attemptConnection(REVESMS_API_URL_HTTP);
            } catch (httpError: any) {
                console.warn(`Secondary test connection failed: ${httpError.message}`);
                try {
                    return await attemptConnection(REVESMS_API_URL_IP);
                } catch (ipError: any) {
                    throw new Error(ipError.message || 'Connection check failed on all endpoints.');
                }
            }
        }
    }

    extractMessageId(result: any): string | null {
        const id = result && (result.Message_ID || result.messageId || result.apiMessageId);
        return id ? String(id) : null;
    }

    async getStatus(messageId: string, config: any): Promise<'sent' | 'delivered' | 'failed' | 'pending'> {
        if (!config.apikey || !config.secretkey) throw new Error('Reve SMS credentials missing.');
        const response = await axios.get(REVESMS_STATUS_URL, {
            params: { apikey: config.apikey, secretkey: config.secretkey, messageid: messageId },
            timeout: 15000,
        });
        const text = String((response.data && response.data.Text) || '').toUpperCase();
        // Check failures before success: "UNDELIVRD" also contains "DELIVR".
        if (/UNDELIV|REJECT|EXPIR|FAIL/.test(text)) return 'failed';
        // Reve returns DELIVRD (no E) for delivered.
        if (/DELIVRD|DELIVERED/.test(text)) return 'delivered';
        if (/SENT|ACCEPT/.test(text)) return 'sent';
        return 'pending';
    }
}
