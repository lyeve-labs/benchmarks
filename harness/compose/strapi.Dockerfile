# Builds the Strapi app for the harness from the committed source in ./strapi-app
# (which carries the article and category content types).
# NOTE: no package-lock.json is committed, so the build is not fully reproducible
# (transitive deps float). For a deterministic benchmark, commit a lockfile and
# switch this to `npm ci --omit=dev`.
# Strapi 5.6.0 declares Node 22 at most, so npm warns on Node 26. The app
# builds and starts on it all the same.
# node:26.12.1-alpine
FROM node@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
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
