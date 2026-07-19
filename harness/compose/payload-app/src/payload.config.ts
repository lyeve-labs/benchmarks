import path from 'path';
import { fileURLToPath } from 'url';
import { buildConfig } from 'payload';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';

import { Users } from './collections/Users';
import { Categories } from './collections/Categories';
import { Articles } from './collections/Articles';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const BENCH_EMAIL = process.env.BENCH_USER_EMAIL || 'admin@lyeve.com';
const BENCH_PASSWORD = process.env.BENCH_USER_PASSWORD || 'benchmark-Passw0rd!';

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || 'benchmark-secret-please-change',
  editor: lexicalEditor(),
  collections: [Users, Categories, Articles],
  db: postgresAdapter({
    // Schema comes from the committed migration, applied by `payload migrate` on
    // start. Cap the pool so a burst of requests can't exhaust Postgres.
    pool: { connectionString: process.env.DATABASE_URI || '', max: 10 },
  }),
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // Create the one benchmark user the login scenario (S05) authenticates as.
  // Idempotent: skipped once the user exists, so restarts are safe.
  onInit: async (payload) => {
    const existing = await payload.find({
      collection: 'users',
      where: { email: { equals: BENCH_EMAIL } },
      limit: 1,
    });
    if (existing.docs.length === 0) {
      await payload.create({
        collection: 'users',
        data: { email: BENCH_EMAIL, password: BENCH_PASSWORD },
      });
    }
  },
});
