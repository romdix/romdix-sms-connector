import { SMSProvider } from './sms-provider.interface';
import { ZenderProvider } from './zender';

export class ProviderFactory {
  static getProvider(type: string): SMSProvider {
    switch (type.toLowerCase()) {
      case 'zender':
        return new ZenderProvider();
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
}
