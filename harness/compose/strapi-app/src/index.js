'use strict';

// Bootstrap runs on every start, both steps idempotent:
//   1. open the article + category REST endpoints to the public and
//      authenticated roles, so seeding and queries need no per-endpoint token;
//   2. create the login user the auth scenario authenticates as.

const API_UIDS = ['api::article.article', 'api::category.category'];
const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'];

async function openPermissions(strapi, roleType) {
  const role = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: roleType } });
  if (!role) return;

  for (const uid of API_UIDS) {
    for (const action of ACTIONS) {
      const name = `${uid}.${action}`;
      const existing = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action: name, role: role.id } });
      if (!existing) {
        await strapi
          .query('plugin::users-permissions.permission')
          .create({ data: { action: name, role: role.id } });
      }
    }
  }
}

async function ensureBenchUser(strapi) {
  const email = process.env.BENCH_USER_EMAIL || 'admin@lyeve.com';
  const password = process.env.BENCH_USER_PASSWORD || 'benchmark-Passw0rd!';

  const existing = await strapi
    .query('plugin::users-permissions.user')
    .findOne({ where: { email } });
  if (existing) return;

  const authRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } });

  await strapi.plugin('users-permissions').service('user').add({
    username: 'benchmark',
    email,
    password,
    provider: 'local',
    confirmed: true,
    blocked: false,
    role: authRole.id,
  });
}

module.exports = {
  register() {},
  async bootstrap({ strapi }) {
    await openPermissions(strapi, 'public');
    await openPermissions(strapi, 'authenticated');
    await ensureBenchUser(strapi);
  },
};
