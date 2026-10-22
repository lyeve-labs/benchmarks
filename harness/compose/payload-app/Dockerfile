# Payload runs as a normal Next.js app with its full node_modules, so the
# `payload migrate` step in the start script (package.json) has the CLI it needs
# to apply the committed migration when the container comes up.
# node:26.12.1-alpine
FROM node@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
WORKDIR /app
RUN apk add --no-cache libc6-compat wget
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
