import { SMSProvider } from './sms-provider.interface';
import { IcombdProvider } from './icombd';
import { ReveSmsProvider } from './revesms';
import { ZenderProvider } from './zender';

export class ProviderFactory {
    static getProvider(type: string): SMSProvider {
        switch (type.toLowerCase()) {
            case 'icombd':
                return new IcombdProvider();
            case 'revesms':
                return new ReveSmsProvider();
            case 'zender':
                return new ZenderProvider();
            default:
                throw new Error(`Unknown provider type: ${type}`);
        }
    }
}
