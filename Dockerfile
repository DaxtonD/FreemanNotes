# Stage 1: build client
FROM node:20-bookworm-slim AS builder
# Link image to GitHub repository for GHCR permissions
LABEL org.opencontainers.image.source="https://github.com/daxtond/freemannotes"
WORKDIR /app
COPY package.json package-lock.json* ./
# Ensure postinstall scripts exist
COPY scripts ./scripts
RUN npm ci --production=false
COPY . .
RUN npm run build

# Stage 2: production image
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Persistent uploads (avatars, etc.). In docker-compose this is backed by a named volume.
RUN mkdir -p /app/uploads/users

# Copy package manifests, scripts, and prisma schema first
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/prisma ./prisma

# Install production dependencies only; skip postinstall scripts (generate Prisma manually)
RUN npm ci --omit=dev --ignore-scripts

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client-dist ./dist/client-dist

# Copy server scripts and set permissions
COPY server/scripts ./server/scripts
RUN chmod +x server/scripts/docker-entrypoint.sh

# Install OpenSSL (for Prisma) and Python/PaddleOCR in a venv.
# Native runtime libs (Debian):
# - libgomp1: OpenMP runtime (PaddlePaddle CPU)
# - libglib2.0-0: required by OpenCV wheels
# - libgl1 + libsm6 + libxext6 + libxrender1 + libxcb1: common OpenCV runtime deps (even for headless builds)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip \
        openssl ca-certificates \
        libgomp1 \
        libglib2.0-0 \
        libgl1 \
        libsm6 libxext6 libxrender1 \
        libxcb1 \
    && \
    python3 -m venv /opt/ocr-venv && \
    /opt/ocr-venv/bin/pip install --no-cache-dir --upgrade pip wheel && \
    /opt/ocr-venv/bin/pip install --no-cache-dir paddlepaddle==2.6.2 && \
    /opt/ocr-venv/bin/pip install --no-cache-dir --no-deps paddleocr==2.7.0 && \
    /opt/ocr-venv/bin/pip install --no-cache-dir \
        numpy Pillow==10.2.0 opencv-python-headless shapely scikit-image \
        imgaug pyclipper lmdb rapidfuzz tqdm visualdl fire requests protobuf scipy && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Generate Prisma client after OpenSSL is installed and schema is present
RUN npx prisma generate

# Point app to the venv Python
ENV PYTHON_BIN=/opt/ocr-venv/bin/python

EXPOSE 4000
ENTRYPOINT ["/bin/sh", "server/scripts/docker-entrypoint.sh"]
