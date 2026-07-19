import type { CollectionConfig } from 'payload';

const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

export const Articles: CollectionConfig = {
  slug: 'articles',
  access: open,
  fields: [
    { name: 'title', type: 'text' },
    { name: 'slug', type: 'text', unique: true, index: true },
    { name: 'body', type: 'textarea' },
    { name: 'views', type: 'number' },
    { name: 'published', type: 'checkbox' },
    { name: 'meta', type: 'json' },
    // Indexed foreign key to category: this is the index the filter scenario
    // (S04) leans on, so no target wins or loses it on a missing index.
    { name: 'category', type: 'relationship', relationTo: 'categories', index: true },
  ],
};
