import axios from 'axios';
import { SMSProvider } from './sms-provider.interface';

// Updated to v1 API based on verified endpoint (v3 returns 404)
// Using IP address as fallback for DNS resolution issues in Docker
const ICOMBD_API_URL = 'http://api.icombd.com/api/v1/campaigns/sendsms/plain';
const ICOMBD_API_URL_IP = 'http://63.142.254.221/api/v1/campaigns/sendsms/plain';

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
}
