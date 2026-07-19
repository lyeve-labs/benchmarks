module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT', env('API_TOKEN_SALT')),
    },
  },
  // The admin panel is not exercised by the benchmark, but Strapi still builds it.
  flags: {
    nps: false,
    promoteEE: false,
  },
});
