# Builds the Strapi app for the harness from the committed source in ./strapi-app
# (which carries the article and category content types).
# NOTE: no package-lock.json is committed, so the build is not fully reproducible
# (transitive deps float). For a deterministic benchmark, commit a lockfile and
# switch this to `npm ci --omit=dev`.
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache wget
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
# The local upload provider refuses to start without this directory, and git
# does not keep an empty one, so a fresh clone could never boot the app.
RUN mkdir -p public/uploads
ENV NODE_ENV=production
RUN npm run build
EXPOSE 1337
CMD ["npm", "run", "start"]
