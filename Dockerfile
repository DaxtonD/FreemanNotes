# Stage 1: build client
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production=false
COPY . .
RUN npm run build

# Stage 2: production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
# Install all deps at runtime so prisma CLI is available for migrations/generate
RUN npm ci --production=false
# Copy built server and client-dist from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client-dist ./client-dist
COPY --from=builder /app/server/package.json ./server/package.json
COPY prisma ./prisma
COPY server/scripts ./server/scripts
RUN chmod +x server/scripts/docker-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["/bin/sh", "server/scripts/docker-entrypoint.sh"]
