# Builds the Strapi app for the harness from the committed source in ./strapi-app
# (which carries the article and category content types).
# Strapi 5.6.0 declares Node 22 at most, so pnpm warns on Node 26. The app
# builds and starts on it all the same.
# node:26.12.1-alpine
FROM node@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
WORKDIR /app
RUN apk add --no-cache wget
# Node 26 ships no corepack, so pnpm comes from the registry at the version
# package.json names in packageManager.
RUN npm install -g pnpm@11.25.0
# The install takes the committed lockfile as it is, refuses a version younger
# than the release-age policy, and runs only the build scripts that
# pnpm-workspace.yaml allows.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY . .
# The local upload provider refuses to start without this directory, and git
# does not keep an empty one, so a fresh clone could never boot the app.
RUN mkdir -p public/uploads
ENV NODE_ENV=production
# package.json lists the admin panel's React peers itself. Without them
# `strapi build` adds them with an install of its own that no lockfile holds.
RUN pnpm run build
EXPOSE 1337
CMD ["pnpm", "run", "start"]
