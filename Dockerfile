FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# 1. Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chromium + deps for Puppeteer
    chromium chromium-driver chromium-sandbox \
    git \
    wget curl gnupg ca-certificates \
    fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
    libgbm1 libglib2.0-0 libgtk-3-0 libnss3 libnspr4 \
    libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libxrender1 \
    libxss1 libxtst6 xdg-utils lsb-release \
    ffmpeg xvfb \
    jq nano unzip \
    && rm -rf /var/lib/apt/lists/*

# 2. Puppeteer env & Fix
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_ARGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu"
RUN ln -s /usr/bin/chromium /usr/bin/chromium-browser

# 3. Install n8n and puppeteer globally
# Add a small retry loop to tolerate transient npm network errors during image builds.
RUN set -eux; \
        npm config set fetch-retries 5; \
        npm config set fetch-retry-mintimeout 20000; \
        npm config set fetch-retry-maxtimeout 120000; \
        for i in 1 2 3; do \
            npm install -g n8n@1.123.6 puppeteer@20 fingerprint-injector && break; \
            echo "npm install failed (attempt $i), retrying..."; \
            sleep 10; \
        done


# 4. Install cheerio, html-minifier-terser, and cloudinary in n8n's node_modules
RUN cd /usr/local/lib/node_modules/n8n && npm install --legacy-peer-deps cheerio html-minifier-terser cloudinary

# 4.5 Download and install uBlock Origin Lite
RUN mkdir -p /opt/ublock && \
    wget -O /tmp/ublock.zip https://github.com/uBlockOrigin/uBOL-home/releases/download/2025.1224.1544/uBOLite_2025.1224.1544.chromium.mv3.zip && \
    unzip /tmp/ublock.zip -d /opt/ublock && \
    rm /tmp/ublock.zip && \
    chmod -R 755 /opt/ublock

# 5. Cloudinary configuration (set via docker-compose or environment variables)
ENV CLOUDINARY_CLOUD_NAME="dktc34wxa"
ENV CLOUDINARY_UPLOAD_PRESET="n8n"
# Note: CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET should be set via docker-compose or secrets

# 5. Setup n8n directory & Switch User
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node
WORKDIR /home/node
USER node

# 7. Copy rest of application
COPY --chown=node:node . .

# Start n8n
CMD ["n8n"]