import { storage } from './services/storage';

export enum AppUserType {
  Company = "Company",
  Location = "Location",
}

export enum TokenType {
  Bearer = "Bearer",
}

export interface InstallationDetails {
  access_token: string;
  token_type: TokenType.Bearer;
  expires_in: number;
  refresh_token: string;
  scope: string;
  userType: AppUserType;
  companyId?: string;
  locationId?: string;
}

/*
 * The Model class owns installation tokens. Tokens are persisted (encrypted) in
 * SQLite so a restart or redeploy does not lose the installation, with an
 * in-process cache in front of it.
 */
export class Model {
  public installationObjects: { [key: string]: InstallationDetails } = {};

  /**
   * Saves installation information based on either the location ID or the company ID.
   */
  async saveInstallationInfo(details: InstallationDetails) {
    const resourceId = details.locationId || details.companyId;
    if (!resourceId) return;
    storage.saveInstallation(resourceId, details as any);
    this.installationObjects[resourceId] = details;
  }

  /**
   * Returns the access token for a location or company, from cache or SQLite.
   */
  getAccessToken(resourceId: string) {
    return this.installationObjects[resourceId]?.access_token || storage.getInstallation(resourceId)?.access_token;
  }

  /**
   * Sets (and persists) the access token for a resource.
   */
  setAccessToken(resourceId: string, token: string) {
    const current = storage.getInstallation(resourceId);
    if (current) {
      current.access_token = token;
      storage.saveInstallation(resourceId, current);
    }
    if (this.installationObjects[resourceId]) {
      this.installationObjects[resourceId].access_token = token;
    }
  }

  /**
   * Returns the refresh token for a location or company, from cache or SQLite.
   */
  getRefreshToken(resourceId: string) {
    return this.installationObjects[resourceId]?.refresh_token || storage.getInstallation(resourceId)?.refresh_token;
  }

  /**
   * Sets (and persists) the refresh token for a resource.
   */
  setRefreshToken(resourceId: string, token: string) {
    const current = storage.getInstallation(resourceId);
    if (current) {
      current.refresh_token = token;
      storage.saveInstallation(resourceId, current);
    }
    if (this.installationObjects[resourceId]) {
      this.installationObjects[resourceId].refresh_token = token;
    }
  }
}
