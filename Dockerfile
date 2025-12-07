FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# 1. Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chromium + deps for Puppeteer
    chromium chromium-driver \
    wget curl gnupg ca-certificates \
    fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
    libgbm1 libglib2.0-0 libgtk-3-0 libnss3 libnspr4 \
    libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libxrender1 \
    libxss1 libxtst6 xdg-utils lsb-release \
    ffmpeg xvfb \
    jq nano \
    && rm -rf /var/lib/apt/lists/*

# 2. Puppeteer env & Fix
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN ln -s /usr/bin/chromium /usr/bin/chromium-browser

# 3. Install n8n and puppeteer globally
RUN npm install -g n8n puppeteer@20 fingerprint-injector playwright

# 3.1. Install Playwright browsers (as root before switching to node user)
RUN npx playwright install chromium --with-deps

# 4. Install cheerio and html-minifier-terser in n8n's node_modules
RUN cd /usr/local/lib/node_modules/n8n && npm install --legacy-peer-deps cheerio html-minifier-terser

# 5. Setup n8n directory & Switch User
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node
WORKDIR /home/node
USER node

# 7. Copy rest of application
COPY --chown=node:node . .

# Start n8n
CMD ["n8n"]