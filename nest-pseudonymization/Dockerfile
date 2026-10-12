FROM node:22-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@12.3.4

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/workers ./workers

EXPOSE 3000
# The same image runs the worker with: node workers/rabbit-worker.js
CMD ["node", "dist/main.js"]
