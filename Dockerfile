# Stage 1: build client
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
# Ensure postinstall script exists before npm ci runs
COPY scripts ./scripts
RUN npm ci --production=false
COPY . .
RUN npm run build

# Stage 2: production image
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Use dependencies from the build stage to avoid re-installing in runtime
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
# Copy built server and client-dist from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client-dist ./client-dist
COPY --from=builder /app/scripts ./scripts
COPY prisma ./prisma
COPY server/scripts ./server/scripts
RUN chmod +x server/scripts/docker-entrypoint.sh

# Install Python and PaddleOCR dependencies in a virtualenv (PEP 668 compliant)
RUN apt-get update && \
	apt-get install -y --no-install-recommends python3 python3-venv python3-pip && \
	python3 -m venv /opt/ocr-venv && \
	/opt/ocr-venv/bin/pip install --no-cache-dir -r scripts/requirements.txt && \
	apt-get clean && rm -rf /var/lib/apt/lists/*

# Point app to the venv Python
ENV PYTHON_BIN=/opt/ocr-venv/bin/python

EXPOSE 4000
ENTRYPOINT ["/bin/sh", "server/scripts/docker-entrypoint.sh"]
