# ════════════════════════════════════════════════════════════════
# 🦞 OpenClaw + 💻 Browser Terminal
# ════════════════════════════════════════════════════════════════
# Port 7861 (exposed): Dashboard + reverse proxy
#   /          → OpenClaw dashboard
#   /app/      → OpenClaw gateway (internal :7860)
#   /terminal/ → xterm.js + node-pty browser terminal (same process)
# ════════════════════════════════════════════════════════════════

# ── Stage 1: Pull pre-built OpenClaw ──
# Pinned (not "latest") so duplicated Spaces get a known-good build with zero
# manual config. Override with an HF Space Variable named OPENCLAW_VERSION
# (or --build-arg locally) to track a newer release.
ARG OPENCLAW_VERSION=2026.6.8
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_VERSION} AS openclaw

# ── Stage 2: Runtime ──
FROM node:22-slim
ARG OPENCLAW_VERSION=2026.6.8
# DEV_MODE is a runtime-only HF Space Variable (read by start.sh) — it has no
# effect at build time since node-pty/ws are always installed below. It
# defaults to unset so start.sh can auto-enable the terminal when
# GATEWAY_TOKEN is present; users can set DEV_MODE=false to opt out.

# Install system dependencies (build-essential is required to compile the
# node-pty native addon used by the browser terminal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    sudo \
    file \
    ca-certificates \
    jq \
    curl \
    dbus \
    dbus-x11 \
    build-essential \
    python3 \
    python3-pip \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxkbcommon0 \
    libx11-6 \
    libxext6 \
    libxfixes3 \
    libasound2 \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    xfonts-scalable \
    --no-install-recommends && \
    pip3 install --no-cache-dir --break-system-packages huggingface_hub hf_transfer && \
    rm -rf /var/lib/apt/lists/*

# Reuse existing node user (UID 1000). Allow passwordless package-manager
# commands only so runtime apt installs can be replayed after HF Space restarts.
RUN mkdir -p /home/node/app /home/node/.openclaw && \
    chown -R 1000:1000 /home/node && \
    printf '%s\n' \
      'Cmnd_Alias OPENCLAW_HF_APT = /usr/bin/apt, /usr/bin/apt-get, /usr/bin/dpkg' \
      'node ALL=(root) NOPASSWD: OPENCLAW_HF_APT' \
      > /etc/sudoers.d/openclaw-hf-apt && \
    chmod 0440 /etc/sudoers.d/openclaw-hf-apt && \
    visudo -cf /etc/sudoers.d/openclaw-hf-apt

# Copy pre-built OpenClaw (skips npm install entirely — much faster!)
COPY --from=openclaw --chown=1000:1000 /app /home/node/.openclaw/openclaw-app

# Add Playwright + the browser terminal's PTY/WebSocket deps in an isolated
# sidecar node_modules (node-pty needs build-essential, installed above)
RUN mkdir -p /home/node/browser-deps && \
    cd /home/node/browser-deps && \
    npm init -y && \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev playwright@1.59.1 node-pty@1.0.0 ws@8.18.0

# Symlink openclaw CLI so it's available globally
RUN ln -s /home/node/.openclaw/openclaw-app/openclaw.mjs /usr/local/bin/openclaw 2>/dev/null || \
    npm install -g openclaw@${OPENCLAW_VERSION}

# Copy OpenClaw files
COPY --chown=1000:1000 cloudflare-proxy.js /opt/cloudflare-proxy.js
COPY --chown=1000:1000 cloudflare-proxy-setup.py /home/node/app/cloudflare-proxy-setup.py
COPY --chown=1000:1000 health-server.js /home/node/app/health-server.js
COPY --chown=1000:1000 static/ /home/node/app/static/
COPY --chown=1000:1000 terminal.html /home/node/app/terminal.html
COPY --chown=1000:1000 iframe-fix.cjs /home/node/app/iframe-fix.cjs
COPY --chown=1000:1000 start.sh /home/node/app/start.sh
COPY --chown=1000:1000 wa-guardian.js /home/node/app/wa-guardian.js
COPY --chown=1000:1000 cloudflare-keepalive-setup.py /home/node/app/cloudflare-keepalive-setup.py
COPY --chown=1000:1000 openclaw-sync.py /home/node/app/openclaw-sync.py
COPY --chown=1000:1000 multi-provider-key-rotator.cjs /home/node/app/multi-provider-key-rotator.cjs
COPY --chown=1000:1000 env-builder.html /home/node/app/env-builder.html
COPY --chown=1000:1000 env-builder.js /home/node/app/env-builder.js
COPY --chown=1000:1000 terminal-devdata-sync.py /home/node/app/terminal-devdata-sync.py
RUN chmod +x /home/node/app/start.sh \
              /home/node/app/cloudflare-proxy-setup.py \
              /home/node/app/cloudflare-keepalive-setup.py \
              /home/node/app/openclaw-sync.py \
              /home/node/app/terminal-devdata-sync.py \
              /home/node/app/multi-provider-key-rotator.cjs

USER node

ENV HOME=/home/node \
    OPENCLAW_VERSION=${OPENCLAW_VERSION} \
    PATH=/home/node/.local/bin:/usr/local/bin:$PATH \
    NODE_PATH=/home/node/browser-deps/node_modules \
    NODE_OPTIONS="--require /opt/cloudflare-proxy.js"

WORKDIR /home/node/app

# 7861 = public entrypoint (dashboard + proxy for both OpenClaw and the terminal)
EXPOSE 7861

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
  CMD curl -fsS http://localhost:7861/health || exit 1

CMD ["/home/node/app/start.sh"]
