export type ProviderDeliveryStatus = 'sent' | 'delivered' | 'failed' | 'pending';

export interface SMSProvider {
  /**
   * Sends an SMS message.
   * @param to The recipient number.
   * @param message The message body.
   * @param config The provider-specific configuration/credentials.
   * @returns Promise resolving to the provider's response.
   */
  sendSMS(to: string, message: string, config: any): Promise<any>;

  /**
   * Tests the connection with the provided configuration.
   * @param config The provider-specific configuration/credentials.
   * @returns Promise resolving to true if connection is successful, or throwing an error.
   */
  testConnection(config: any): Promise<boolean>;

  /** Provider-side message id from a send response, used to poll delivery status. */
  extractMessageId?(result: any): string | null;

  /** Poll the provider for the current delivery state of a message. */
  getStatus?(messageId: string, config: any): Promise<ProviderDeliveryStatus>;
}
