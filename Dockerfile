FROM node:18-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm ci --omit=dev

FROM node:18-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
