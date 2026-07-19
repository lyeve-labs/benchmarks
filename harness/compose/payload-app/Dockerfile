# Payload runs as a normal Next.js app with its full node_modules, so the
# `payload migrate` step in the start script (package.json) has the CLI it needs
# to apply the committed migration when the container comes up.
FROM node:24-alpine
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
