import type { CollectionConfig } from 'payload';

// Open access on purpose: the harness seeds and queries without a token, exactly
// like it does against the other targets. This is a throwaway benchmark app, not
// a production deployment.
const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

export const Categories: CollectionConfig = {
  slug: 'categories',
  access: open,
  fields: [
    { name: 'name', type: 'text' },
    { name: 'slug', type: 'text', unique: true, index: true },
  ],
};
