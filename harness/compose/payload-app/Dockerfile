# Payload runs as a normal Next.js app with its full node_modules, so the
# `payload migrate` step in the start script (package.json) has the CLI it needs
# to apply the committed migration when the container comes up.
# node:26.12.1-alpine
FROM node@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
WORKDIR /app
RUN apk add --no-cache libc6-compat wget
# Node 26 ships no corepack, so pnpm comes from the registry at the version
# package.json names in packageManager.
RUN npm install -g pnpm@11.25.0
# The install takes the committed lockfile as it is, refuses a version younger
# than the release-age policy, and runs only the build scripts that
# pnpm-workspace.yaml allows.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build
EXPOSE 3000
CMD ["pnpm", "run", "start"]
