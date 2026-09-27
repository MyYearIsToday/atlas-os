/**
 * Provider seam for the future Firebase implementation.
 *
 * Firebase is intentionally not initialized in this build. When credentials
 * are connected, implement this contract with Firestore, Auth, and Storage
 * without changing the pages or business logic.
 */
export interface AtlasDataProvider {
  loadSnapshot: () => Promise<unknown>;
  saveSnapshot: (snapshot: unknown) => Promise<void>;
  uploadReport: (file: File) => Promise<{ path: string; url?: string }>;
  signIn: () => Promise<unknown>;
  signOut: () => Promise<void>;
}

export const firebaseProviderPlaceholder: AtlasDataProvider = {
  loadSnapshot: async () => {
    throw new Error('Firebase provider is paused until project credentials are connected.');
  },
  saveSnapshot: async () => {
    throw new Error('Firebase provider is paused until project credentials are connected.');
  },
  uploadReport: async () => {
    throw new Error('Firebase Storage is paused until project credentials are connected.');
  },
  signIn: async () => {
    throw new Error('Firebase Authentication is paused until project credentials are connected.');
  },
  signOut: async () => {
    throw new Error('Firebase Authentication is paused until project credentials are connected.');
  },
};