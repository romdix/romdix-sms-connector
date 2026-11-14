import { SMSProvider } from './sms-provider.interface';
import { IcombdProvider } from './icombd';
import { ReveSmsProvider } from './revesms';

export class ProviderFactory {
    static getProvider(type: string): SMSProvider {
        switch (type.toLowerCase()) {
            case 'icombd':
                return new IcombdProvider();
            case 'revesms':
                return new ReveSmsProvider();
            default:
                throw new Error(`Unknown provider type: ${type}`);
        }
    }
}
