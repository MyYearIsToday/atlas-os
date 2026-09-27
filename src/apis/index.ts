/**
 * External API boundaries for Atlas.
 *
 * Firebase and Google Business Profile integrations intentionally stay disabled
 * until credentials are connected. Keeping the boundary here prevents UI
 * components from coupling to an eventual provider implementation.
 */
export interface AtlasApiClient {
  getBusinessProfile: (placeId: string) => Promise<unknown>;
  requestVisibilityRefresh: (clientId: string) => Promise<unknown>;
}

export const unavailableApiClient: AtlasApiClient = {
  getBusinessProfile: async () => {
    throw new Error('Business profile API is not connected yet.');
  },
  requestVisibilityRefresh: async () => {
    throw new Error('Visibility refresh API is not connected yet.');
  },
};