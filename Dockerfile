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
      PPTR_VER="$(node -p 'require("/usr/src/app/node_modules/puppeteer-core/package.json").version')" && \
      if [ "$PPTR_VER" = "24.38.0" ]; then \
        echo "Applying OOP iframe TargetCloseError backport to puppeteer-core@$PPTR_VER (see patches/README.md)" && \
        patch -p1 -d node_modules/puppeteer-core < patches/puppeteer-core+24.38.0.patch; \
      else \
        echo "puppeteer-core is $PPTR_VER, not 24.38.0 - skipping local patch (see patches/README.md)"; \
      fi && \
      apt-get purge -y patch && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
    fi

# Create the final stage
FROM base

# Chromium is pinned. Unpinned, every rebuild pulled whatever Debian shipped that day
# (151 -> 152 -> 153 in two days, Sep 2026) and a browser change broke session startup.
# It comes from Debian's snapshot archive, still signature-checked by apt, so this exact
# version stays installable after the live security repo moves on.
# To upgrade, set both ARGs (the snapshot must contain that version).
ARG CHROMIUM_VERSION=153.0.8010.47-2~deb12u1
ARG CHROMIUM_SNAPSHOT=20260918T144605Z

# Install system dependencies
RUN echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${CHROMIUM_SNAPSHOT} bookworm-security main" \
      > /etc/apt/sources.list.d/chromium-snapshot.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    fonts-freefont-ttf \
    chromium=${CHROMIUM_VERSION} \
    chromium-common=${CHROMIUM_VERSION} \
    ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/chromium-snapshot.list

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
