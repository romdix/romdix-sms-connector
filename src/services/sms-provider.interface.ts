export interface SMSProvider {
    /**
     * Sends an SMS message.
     * @param to The recipient number.
     * @param messageThe message body.
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
}
