import type { CollectionConfig } from 'payload';

// The auth collection. The benchmark only needs it for the login scenario (S05).
// One user is created at startup by onInit in payload.config.ts.
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  fields: [],
};
