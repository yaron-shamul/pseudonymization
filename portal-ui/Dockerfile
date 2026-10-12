# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage: nginx serves the static app and proxies /api -> api:3000
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /app/dist

EXPOSE 4173
CMD ["nginx", "-g", "daemon off;"]
