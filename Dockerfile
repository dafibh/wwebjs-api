# Use the official Node.js Debian image as the base image
FROM node:22-bookworm-slim AS base

ENV CHROME_BIN="/usr/bin/chromium" \
    PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true" \
    NODE_ENV="production"

WORKDIR /usr/src/app

FROM base AS deps

ARG USE_EDGE=false

COPY package*.json ./
COPY patches ./patches

RUN if [ "$USE_EDGE" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends git ca-certificates && \
      npm ci --only=production --ignore-scripts && \
      npm install --save-exact git+https://github.com/pedroslopez/whatsapp-web.js.git#main && \
      apt-get purge -y git ca-certificates && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
    else \
      apt-get update && apt-get install -y --no-install-recommends patch && \
      npm ci --only=production --ignore-scripts && \
      WWEBJS_VER="$(node -p 'require("/usr/src/app/node_modules/whatsapp-web.js/package.json").version')" && \
      if [ "$WWEBJS_VER" = "1.34.7" ]; then \
        echo "Applying WA 2.3000.1043xxx serialized-id compat patch to whatsapp-web.js@$WWEBJS_VER (see patches/README.md)" && \
        patch -p1 -d node_modules/whatsapp-web.js < patches/whatsapp-web.js+1.34.7.patch; \
      else \
        echo "whatsapp-web.js is $WWEBJS_VER, not 1.34.7 - skipping local patch (see patches/README.md)"; \
      fi && \
      apt-get purge -y patch && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
    fi

# Create the final stage
FROM base

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    fonts-freefont-ttf \
    chromium \
    ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy only production dependencies from deps stage
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=deps /usr/src/app/package*.json ./

# Copy application code
COPY server.js ./
COPY LICENSE ./
COPY swagger.json ./
COPY src/ ./src/

EXPOSE 3000

CMD ["npm", "start"]
