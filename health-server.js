// Single public entrypoint for HF Spaces: dashboard + reverse proxy to OpenClaw + JupyterLab.
const http = require("http");
const https = require("https");
const fs = require("fs");
const net = require("net");
const crypto = require("crypto");

function isTrue(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}
function normalizeBase(value, fallback) {
  const raw = String(value || fallback || "").trim() || fallback;
  if (!raw) return fallback;
  const base = raw.startsWith("/") ? raw : `/${raw}`;
  return base.replace(/\/+$/, "") || fallback;
}

const PORT = Number.parseInt(process.env.PORT || "7861", 10);
const GATEWAY_PORT = Number.parseInt(process.env.GATEWAY_PORT || "7860", 10);
const GATEWAY_HOST = "127.0.0.1";
const JUPYTER_PORT = Number.parseInt(process.env.JUPYTER_PORT || "8888", 10);
const JUPYTER_HOST = "127.0.0.1";
const JUPYTER_BASE = normalizeBase(process.env.JUPYTER_BASE, "/terminal");
const GATEWAY_TOKEN = (process.env.GATEWAY_TOKEN || "").trim();
const SESSION_COOKIE = "hc_session";
const LOGIN_PATH = "/login";
const DEV_MODE_ENABLED = isTrue(process.env.DEV_MODE);
// Explicit OPENCLAW_HF_JUPYTER_ENABLED=true enables Jupyter.
// Otherwise DEV_MODE=true enables it unless OPENCLAW_HF_JUPYTER_ENABLED is explicitly false.
// OPENCLAW_HF_JUPYTER_ENABLED=true is the explicit user override and always wins.
const JUPYTER_ENABLED =
  /^(true|1|yes|on)$/i.test(String(process.env.OPENCLAW_HF_JUPYTER_ENABLED || "").trim()) ||
  (
    isTrue(process.env.DEV_MODE) &&
    !/^(false|0|no|off)$/i.test(String(process.env.OPENCLAW_HF_JUPYTER_ENABLED || "").trim())
  );
const startTime = Date.now();
const LLM_MODEL = process.env.LLM_MODEL || "Not Set";
const LLM_PROVIDER = LLM_MODEL.includes("/") ? LLM_MODEL.split("/")[0] : "";
const TELEGRAM_WEBHOOK_URL = (process.env.TELEGRAM_WEBHOOK_URL || "").trim();
const TELEGRAM_CONFIGURED = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALLOWED_USERS);
const WHATSAPP_ENABLED = isTrue(process.env.WHATSAPP_ENABLED);
const WHATSAPP_STATUS_FILE = "/tmp/openclaw-hf-wa-status.json";
const HF_BACKUP_ENABLED = !!process.env.HF_TOKEN;
const SYNC_INTERVAL = (process.env.SYNC_INTERVAL || "180").trim() || "180";
const BACKUP_DATASET_NAME = (process.env.BACKUP_DATASET_NAME || process.env.BACKUP_DATASET || "openclaw-hf-backup").trim() || "openclaw-hf-backup";
const DEVDATA_DATASET_NAME = (process.env.DEVDATA_DATASET_NAME || "openclaw-hf-devdata").trim() || "openclaw-hf-devdata";
const DEVDATA_SYNC_INTERVAL = (process.env.DEVDATA_SYNC_INTERVAL || "180").trim() || "180";
const DEVDATA_SEPARATE_DATASET = DEVDATA_DATASET_NAME !== BACKUP_DATASET_NAME;
const DEVDATA_ENABLED = JUPYTER_ENABLED && HF_BACKUP_ENABLED && DEVDATA_SEPARATE_DATASET && !/^(off|false|0|no)$/i.test((process.env.DEVDATA || "on").trim());
const APP_BASE = normalizeBase(process.env.APP_BASE, "/app");
const SYNC_STATUS_FILE = "/tmp/sync-status.json";

// ── Private Space redirect support ──
// HF automatically sets SPACE_ID as "username/spacename" in every Space container.
const SPACE_ID = (process.env.SPACE_ID || "").trim();
const SPACE_HOST = (process.env.SPACE_HOST || "").trim();
function deriveHfSpaceUrl() {
  if (SPACE_ID) return `https://huggingface.co/spaces/${SPACE_ID}`;
  const host = (process.env.SPACE_HOST || "").replace(/\.hf\.space$/i, "");
  const author = (process.env.SPACE_AUTHOR_NAME || "").trim().toLowerCase();
  if (author && host.toLowerCase().startsWith(author + "-")) {
    const spaceName = host.slice(author.length + 1);
    return `https://huggingface.co/spaces/${process.env.SPACE_AUTHOR_NAME}/${spaceName}`;
  }
  return "";
}
const HF_SPACE_URL = deriveHfSpaceUrl();
const _privacyWaitRaw = Number(process.env.PRIVACY_DETECTION_WAIT_MS || "1500");
const PRIVACY_DETECTION_WAIT_MS = Number.isFinite(_privacyWaitRaw)
  ? Math.max(0, Math.floor(_privacyWaitRaw))
  : 1500;

// ── Privacy Detection ──
// Priority order:
//   1. SPACE_PRIVACY env var ("public" / "private") — explicit user override, most reliable
//   2. HF API call to huggingface.co — auto-detect
//   3. Fail-secure default: treat as private if SPACE_ID is set

// 1. Check explicit env var override first
const _spacPrivacyEnv = (process.env.SPACE_PRIVACY || "").trim().toLowerCase();
let SPACE_IS_PRIVATE;
let _privacyDetectionDone = false;
let _privacyDetectionResolve;
const privacyDetectionReady = new Promise((res) => { _privacyDetectionResolve = res; });

if (_spacPrivacyEnv === "public") {
  // User explicitly set SPACE_PRIVACY=public — skip API call entirely
  SPACE_IS_PRIVATE = false;
  _privacyDetectionDone = true;
  console.log("[health-server] Space privacy: public (SPACE_PRIVACY env var override)");
  _privacyDetectionResolve && _privacyDetectionResolve();
} else if (_spacPrivacyEnv === "private") {
  // User explicitly set SPACE_PRIVACY=private — skip API call entirely
  SPACE_IS_PRIVATE = true;
  _privacyDetectionDone = true;
  console.log("[health-server] Space privacy: private (SPACE_PRIVACY env var override)");
  _privacyDetectionResolve && _privacyDetectionResolve();
} else {
  // 2. Auto-detect via HF API (with fail-secure default)
  // Default to private if SPACE_ID is set — gets corrected by API call below.
  SPACE_IS_PRIVATE = !!SPACE_ID;
}

async function detectSpacePrivacy() {
  // Skip if already resolved via env var
  if (_spacPrivacyEnv === "public" || _spacPrivacyEnv === "private") return;
  // Skip if not running on HF Spaces
  if (!SPACE_ID) {
    SPACE_IS_PRIVATE = false;
    _privacyDetectionDone = true;
    _privacyDetectionResolve();
    return;
  }

  const token = (process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN || "").trim();
  const reqOptions = {
    hostname: "huggingface.co",
    path: `/api/spaces/${SPACE_ID}`,
    method: "GET",
    headers: Object.assign(
      { "User-Agent": "OpenClaw/health-server" },
      token ? { Authorization: `Bearer ${token}` } : {}
    ),
  };

  // Retry up to 5 times with increasing delay — covers transient failures at boot
  const MAX_ATTEMPTS = 5;
  let detected = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await new Promise((resolve) => {
        const r = https.request(reqOptions, (apiRes) => {
          let body = "";
          apiRes.on("data", (chunk) => { body += chunk; });
          apiRes.on("end", () => {
            try {
              if (apiRes.statusCode === 200) {
                const data = JSON.parse(body);
                // API confirmed privacy status
                SPACE_IS_PRIVATE = data.private === true;
                resolve({ ok: true, status: apiRes.statusCode });
              } else if (apiRes.statusCode === 401 || apiRes.statusCode === 403) {
                // 401/403 on /api/spaces means the space IS private and our token
                // is missing or wrong. Mark as private.
                SPACE_IS_PRIVATE = true;
                resolve({ ok: true, status: apiRes.statusCode, forcedPrivate: true });
              } else if (apiRes.statusCode === 404) {
                // Space not found — shouldn't happen but treat as non-blocking; default stays.
                resolve({ ok: false, status: apiRes.statusCode });
              } else {
                // Other non-200 — transient; retry
                resolve({ ok: false, status: apiRes.statusCode });
              }
            } catch { resolve({ ok: false, status: apiRes.statusCode }); }
          });
        });
        r.on("error", (err) => resolve({ ok: false, error: err.message }));
        r.setTimeout(8000, () => { r.destroy(); resolve({ ok: false, error: "timeout" }); });
        r.end();
      });

      console.log(`[health-server] Privacy detection attempt ${attempt}/${MAX_ATTEMPTS}: status=${result.status || "network-error"} ok=${result.ok}`);

      if (result.ok) { detected = true; break; }
    } catch (err) {
      console.warn(`[health-server] Privacy detection attempt ${attempt} threw: ${err.message}`);
    }

    const delay = Math.min(2000 * attempt, 10000); // 2s, 4s, 6s, 8s, 10s
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  if (!detected) {
    console.warn(
      `[health-server] Privacy detection failed after ${MAX_ATTEMPTS} attempts — ` +
      `defaulting to ${SPACE_IS_PRIVATE ? "private" : "public"}. ` +
      `TIP: Set SPACE_PRIVACY=public (or private) in your Space secrets to skip API detection.`
    );
  } else {
    console.log(`[health-server] Space privacy detected via HF API: ${SPACE_IS_PRIVATE ? "private" : "public"}`);
  }

  _privacyDetectionDone = true;
  _privacyDetectionResolve();
}

// Only run API detection if env var override not used
if (_spacPrivacyEnv !== "public" && _spacPrivacyEnv !== "private") {
  detectSpacePrivacy();
  // Re-check every 5 minutes so runtime public↔private changes are picked up
  setInterval(detectSpacePrivacy, 5 * 60 * 1000);
}
const CLOUDFLARE_KEEPALIVE_STATUS_FILE =
  "/tmp/openclaw-hf-cloudflare-keepalive-status.json";

function parseRequestUrl(url) {
  try { return new URL(url, "http://localhost"); }
  catch { return new URL("http://localhost/"); }
}

function getSyncStatus() {
  try {
    if (fs.existsSync(SYNC_STATUS_FILE))
      return JSON.parse(fs.readFileSync(SYNC_STATUS_FILE, "utf8"));
  } catch {}
  if (HF_BACKUP_ENABLED)
    return { status: "configured", message: `Backup enabled. Waiting for sync window (${SYNC_INTERVAL}s).` };
  return { status: "unknown", message: "No sync data yet" };
}

function readGuardianStatus() {
  if (!WHATSAPP_ENABLED) return { configured: false, connected: false, pairing: false };
  try {
    if (fs.existsSync(WHATSAPP_STATUS_FILE)) {
      const p = JSON.parse(fs.readFileSync(WHATSAPP_STATUS_FILE, "utf8"));
      return { configured: p.configured !== false, connected: p.connected === true, pairing: p.pairing === true };
    }
  } catch {}
  return { configured: true, connected: false, pairing: false };
}

function getKeepaliveStatus() {
  try {
    if (fs.existsSync(CLOUDFLARE_KEEPALIVE_STATUS_FILE))
      return JSON.parse(fs.readFileSync(CLOUDFLARE_KEEPALIVE_STATUS_FILE, "utf8"));
  } catch {}
  return null;
}

function probePort(host, port, path, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: host, port, path, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

function formatUptime(ms) {
  const t = Math.floor(ms / 1000);
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function escapeHtml(v) {
  return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function parseCookies(req) {
  const h = req.headers.cookie || "";
  return Object.fromEntries(h.split(";").map(c => c.trim().split("=")).filter(p => p.length >= 2).map(([k, ...v]) => [k.trim(), decodeURIComponent(v.join("=").trim())]));
}

// Constant-time comparison using crypto — prevent timing attacks
function timingSafeEqualString(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function expectedSessionValue() {
  if (!GATEWAY_TOKEN) return "";
  return crypto.createHmac("sha256", GATEWAY_TOKEN).update("openclaw-hf-session-v1").digest("hex");
}

function isHttpsRequest(req) {
  return req.headers["x-forwarded-proto"] === "https";
}

function buildSessionCookie(req) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(expectedSessionValue())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`;
}

function getBearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  return match ? match[1] : "";
}

function isAuthorized(req) {
  if (!GATEWAY_TOKEN) return true;
  return (
    timingSafeEqualString(getBearerToken(req), GATEWAY_TOKEN) ||
    timingSafeEqualString(parseCookies(req)[SESSION_COOKIE], expectedSessionValue())
  );
}

function sanitizeNext(value) {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function loginUrl(nextPath) {
  return `${LOGIN_PATH}?next=${encodeURIComponent(sanitizeNext(nextPath))}`;
}

function requireAuth(req, res) {
  if (isAuthorized(req)) return true;
  const parsed = parseRequestUrl(req.url);
  res.writeHead(302, { Location: loginUrl(parsed.pathname + parsed.search), "Cache-Control": "no-store" });
  res.end();
  return false;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 4096) { body = ""; req.destroy(); } });
    req.on("end", () => resolve(body));
    req.on("error", () => resolve(""));
  });
}

function renderLoginPage(nextPath = "/", error = false) {
  const safeNext = sanitizeNext(nextPath);
  const warnBox = SPACE_HOST
    ? `<div class="auth-warn">
        If login doesn't stick, open the Space in its own tab first &mdash; embedded iframes block session cookies in most browsers.<br>
        <a href="https://${escapeHtml(SPACE_HOST)}${LOGIN_PATH}?next=${encodeURIComponent(safeNext)}" target="_blank" rel="noopener">Open in new tab &rarr;</a>
      </div>`
    : "";
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<title>Login &middot; OpenClaw</title>
<link rel="stylesheet" href="/static/style.css"/>
</head><body>
<div class="auth-wrap">
  <div class="auth-card">
    <div class="auth-brand">
      <div class="auth-glyph"><div class="auth-glyph-dot"></div></div>
      <span class="auth-brand-name">OpenClaw</span>
    </div>

    <div class="auth-h">Authenticate</div>
    <div class="auth-sub">Enter your GATEWAY_TOKEN to access the dashboard.</div>

    ${warnBox}
    ${!GATEWAY_TOKEN ? `<div class="auth-err">GATEWAY_TOKEN is not set. Add it under Settings &rarr; Variables and secrets, then restart the Space.</div>` : ""}
    ${error ? `<div class="auth-err">Invalid token &mdash; try again</div>` : ""}

    <form method="post" action="${LOGIN_PATH}">
      <input type="hidden" name="next" value="${escapeHtml(safeNext)}" />
      <input class="auth-input" type="password" name="token" placeholder="GATEWAY_TOKEN" autofocus autocomplete="current-password" required>
      <button class="btn primary" type="submit" style="width:100%;justify-content:center;">Unlock &rarr;</button>
    </form>
  </div>
</div>
${SPACE_HOST ? `<script>
(function () {
  try {
    if (window.top !== window.self) {
      window.top.location.href = "https://${SPACE_HOST}" + window.location.pathname + window.location.search;
    }
  } catch (e) {}
}());
</script>` : ""}
</body></html>`;
}

function renderDashboard({ uptimeHuman, gatewayReady, sync, keepalive, authenticated }) {
  const syncStatus = String(sync?.status || "unknown");
  const backupTone = ["success", "restored", "synced", "configured"].includes(syncStatus) ? "ok"
    : syncStatus.includes("error") ? "err"
    : (!HF_BACKUP_ENABLED || syncStatus === "disabled" || syncStatus === "unknown") ? "warn"
    : "info";
  const backupPillLabel = backupTone === "ok" ? "Synced"
    : backupTone === "err" ? "Error"
    : backupTone === "warn" ? (HF_BACKUP_ENABLED ? syncStatus : "No HF_TOKEN")
    : syncStatus;

  const kaConf = keepalive?.configured === true;
  const kaTone = kaConf ? "ok" : "warn";
  const kaPillLabel = kaConf ? "Active" : process.env.CLOUDFLARE_WORKERS_TOKEN ? (keepalive?.status || "Pending") : "Not set";

  const modelConfigured = LLM_MODEL !== "Not Set";
  const gwTone = gatewayReady ? "ok" : "err";

  const actions = [`<a class="btn primary" data-space-link="app" href="${APP_BASE}/">Open Agent &rarr;</a>`];
  if (JUPYTER_ENABLED) actions.push(`<a class="btn" data-space-link="terminal" href="${JUPYTER_BASE}/">Terminal</a>`);
  if (authenticated) {
    actions.push(`<a class="btn" data-space-link="env-builder" href="/env-builder">ENV Builder</a>`);
    actions.push(`<a class="btn ghost" href="/logout">Logout</a>`);
  } else {
    actions.push(`<a class="btn" href="/login?next=/env-builder">Login</a>`);
  }

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<title>OpenClaw</title>
<link rel="stylesheet" href="/static/style.css"/>
</head><body>

<div class="pg">

  <div class="pg-hero">
    <div class="pg-glyph">🦞</div>
    <div class="pg-title">OpenClaw</div>
    <div class="pg-sub">SELF-HOSTED &middot; OPENCLAW AGENT</div>
  </div>

  <div class="pg-actions">${actions.join("\n    ")}</div>

  <p class="pg-hint">
    Open Agent${JUPYTER_ENABLED ? " and Terminal" : ""} in a new tab from <code style="font-size:.9em;">*.hf.space</code>
    &mdash; embedded iframes may block session cookies. If you land on Login
    while embedded, this page automatically escapes to a top-level tab.
  </p>

  <div class="pg-status-hd">
    <div class="pg-status-title">Status</div>
    <div class="pg-refresh"><div class="pg-refresh-dot"></div><span id="refreshLabel">live</span></div>
  </div>

  <div class="grid" id="statusGrid">

    <div class="card ${gwTone}" id="card-gateway">
      <div class="card-lbl">Gateway</div>
      <div class="card-row">
        ${gatewayReady ? `<span class="pill ok"><span class="dot pulse"></span>&nbsp;Online</span>` : `<span class="pill err">Offline</span>`}
        ${GATEWAY_TOKEN ? `<span class="pill info">Protected</span>` : ""}
      </div>
      <div class="card-body" id="gw-body">${gatewayReady ? "OpenClaw gateway is live." : "Not running — check Space logs."}</div>
    </div>

    <div class="card ${modelConfigured ? "ok" : "warn"}" id="card-model">
      <div class="card-lbl">Language Model</div>
      <div class="card-row">
        ${modelConfigured ? `<span class="pill ok">Ready</span>` : `<span class="pill warn">Not set</span>`}
        <span class="tag">${escapeHtml(LLM_PROVIDER || "—")}</span>
      </div>
      <div class="card-body"><strong>${escapeHtml(LLM_MODEL)}</strong></div>
    </div>

    <div class="card info" id="card-runtime">
      <div class="card-lbl">Runtime</div>
      <div class="card-row">
        <span class="pill info">Up</span>
        <span class="tag">:${PORT}</span>
      </div>
      <div class="metric" id="rt-uptime">${escapeHtml(uptimeHuman)}</div>
      <div class="metric-lbl">uptime</div>
    </div>

    <div class="card ${TELEGRAM_CONFIGURED ? "ok" : "warn"}" id="card-telegram">
      <div class="card-lbl">Telegram</div>
      <div class="card-row">
        ${TELEGRAM_CONFIGURED ? `<span class="pill ok">Configured</span>` : `<span class="pill warn">Not set</span>`}
      </div>
      <div class="card-body" id="tg-body">${TELEGRAM_CONFIGURED
        ? `${TELEGRAM_WEBHOOK_URL ? "Webhook" : "Polling"}${process.env.CLOUDFLARE_PROXY_URL ? " via CF proxy" : ""}`
        : `Set <strong>TELEGRAM_BOT_TOKEN</strong> &amp; <strong>TELEGRAM_ALLOWED_USERS</strong> to enable`}</div>
    </div>

    <div class="card ${backupTone}" id="card-backup">
      <div class="card-lbl">State Backup</div>
      <div class="card-row"><span class="pill ${backupTone}">${escapeHtml(backupPillLabel)}</span></div>
      <div class="card-body" id="backup-body">${escapeHtml(sync?.message || "No status yet")}${sync?.timestamp ? `<br><span class="local-time" data-iso="${escapeHtml(sync.timestamp)}"></span>` : ""}</div>
    </div>

    <div class="card ${kaTone}" id="card-keepawake">
      <div class="card-lbl">Keep Awake</div>
      <div class="card-row"><span class="pill ${kaTone}">${escapeHtml(kaPillLabel)}</span></div>
      <div class="card-body" id="ka-body">${kaConf
        ? `Pinging <code>${escapeHtml(keepalive?.targetUrl || "/health")}</code>`
        : process.env.CLOUDFLARE_WORKERS_TOKEN ? "Worker pending or failed" : "Set <strong>CLOUDFLARE_WORKERS_TOKEN</strong> to enable"}</div>
    </div>

  </div>

  ${!authenticated ? `<div class="pg-auth-hint"><a href="/login?next=/env-builder">Login</a> to access the ENV Builder and manage configuration.</div>` : ""}

  <div class="foot">
    Developed by <a href="https://linkedin.com/in/itanvirtuhin" target="_blank" rel="noopener">Tanvir Tuhin</a> &middot;
    powered by <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noopener">OpenClaw</a>
  </div>

</div>

<script>
document.querySelectorAll('.local-time').forEach(el=>{const d=new Date(el.getAttribute('data-iso'));if(!isNaN(d))el.textContent='Last sync '+d.toLocaleTimeString()});

const inEmbeddedApp = (() => { try { return window.top !== window.self; } catch { return true; } })();
const isDirectHfSpaceHost = /\.hf\.space$/i.test(window.location.hostname);
const HF_SPACE_URL = ${JSON.stringify(HF_SPACE_URL)};
// Server-side detected value (may be stale if page was cached — see /api/is-private)
let SPACE_IS_PRIVATE = ${JSON.stringify(SPACE_IS_PRIVATE)};

function applyLinkTargets() {
  // Keep hero buttons in-frame for private spaces; open new tab for public spaces
  // accessed via the HF iframe or directly at .hf.space.
  const openInNewTab = !SPACE_IS_PRIVATE && (inEmbeddedApp || isDirectHfSpaceHost);
  document.querySelectorAll('a[data-space-link]').forEach((a) => {
    if (openInNewTab) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    } else {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }
  });
}

applyLinkTargets();

// Always re-fetch the live privacy status from the server to handle:
// 1. Startup race condition where server rendered before API detection finished
// 2. Any mismatch between client-rendered value and actual server-side state
// 3. Public spaces where the fail-secure default (private) needs correcting
// Also retries after 4s in case the first fetch raced with a server-side retry.
function syncPrivacy() {
  return fetch('/api/is-private', { cache: 'no-store' })
    .then(r => r.json())
    .then(d => {
      if (d.isPrivate !== SPACE_IS_PRIVATE) {
        SPACE_IS_PRIVATE = d.isPrivate;
        applyLinkTargets(); // re-run: adds or removes target="_blank" on buttons
      }
      return d.isPrivate;
    })
    .catch(() => SPACE_IS_PRIVATE);
}

if (isDirectHfSpaceHost) {
  // Immediate check on page load
  syncPrivacy().then(isPrivate => {
    // If space appears private after first check, re-verify after server retries
    // complete (server retries up to 3×5s = ~15s). This catches the edge case
    // where a PUBLIC space returned private due to a transient API failure.
    if (isPrivate) {
      setTimeout(syncPrivacy, 8000);
      setTimeout(syncPrivacy, 16000);
    }
  });
}
// Direct .hf.space access outside the HF App iframe has no valid session cookie
// for private spaces — HF CDN returns 404 before the request reaches the container.
// Redirect users to huggingface.co/spaces/... which authenticates them properly.
if (SPACE_IS_PRIVATE && isDirectHfSpaceHost && !inEmbeddedApp && HF_SPACE_URL) {
  const notice = document.createElement('div');
  notice.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#08090e;color:#dde5f8;font-family:sans-serif;flex-direction:column;gap:16px;z-index:9999';
  notice.innerHTML = '<span style="font-size:1.1rem">🔒 Private Space &mdash; Redirecting&hellip;</span><a href="' + HF_SPACE_URL + '" style="color:#818cf8;font-size:.85rem">Click here if not redirected</a>';
  document.body.appendChild(notice);
  setTimeout(() => { window.location.replace(HF_SPACE_URL); }, 300);
}

// ── Live status polling (mirrors the refresh cadence of the upstream template) ──
(function () {
  var label = document.getElementById('refreshLabel');

  function applyStatus(s) {
    var c = document.getElementById('card-gateway');
    if (c) c.className = 'card ' + (s.gatewayReady ? 'ok' : 'err');
    var gwBody = document.getElementById('gw-body');
    if (gwBody) gwBody.textContent = s.gatewayReady ? 'OpenClaw gateway is live.' : 'Not running — check Space logs.';

    var uptime = document.getElementById('rt-uptime');
    if (uptime) uptime.textContent = s.uptime;

    if (s.sync) {
      c = document.getElementById('card-backup');
      var st = String(s.sync.status || 'unknown');
      var tone = ['success', 'restored', 'synced', 'configured'].includes(st) ? 'ok'
        : st.includes('error') ? 'err'
        : (st === 'disabled' || st === 'unknown') ? 'warn'
        : 'info';
      if (c) c.className = 'card ' + tone;
      var bb = document.getElementById('backup-body');
      if (bb) bb.textContent = s.sync.message || 'No status yet';
    }

    if (s.keepalive) {
      c = document.getElementById('card-keepawake');
      if (c) c.className = 'card ' + (s.keepalive.configured ? 'ok' : 'warn');
    }
  }

  function tick() {
    fetch('/status')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        applyStatus(d);
        if (label) label.textContent = 'updated ' + new Date().toLocaleTimeString();
      })
      .catch(function () { if (label) label.textContent = 'offline'; });
  }

  setInterval(tick, 30000);
}());
</script>

</body></html>`;
}

function renderPrivateRedirect(targetUrl) {
  const safeUrl = escapeHtml(targetUrl);
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<title>OpenClaw &middot; Private Space</title>
<link rel="stylesheet" href="/static/style.css"/>
</head><body>
<div class="auth-wrap">
  <div class="auth-card" style="text-align:center;">
    <div class="auth-brand" style="justify-content:center;">
      <div class="auth-glyph"><div class="auth-glyph-dot"></div></div>
      <span class="auth-brand-name">Private Space</span>
    </div>
    <p class="auth-sub" style="margin-bottom:22px;">
      This Space is private. You need to be logged in to <strong style="color:var(--text);">huggingface.co</strong>
      to access it.<br>Redirecting you now&hellip;
    </p>
    <a class="btn primary" href="${safeUrl}" style="width:100%;justify-content:center;">Open on Hugging Face &rarr;</a>
    <div class="auth-sub" style="margin:14px 0 0;">Redirecting in 3 seconds&hellip;</div>
  </div>
</div>
<script>
  // Only auto-redirect when NOT inside an iframe (e.g. HF App tab embeds this
  // page in an iframe; navigating that iframe to huggingface.co is blocked by
  // X-Frame-Options and causes "refused to connect" in the browser).
  const _inFrame = (() => { try { return window.top !== window.self; } catch { return true; } })();
  if (!_inFrame) {
    setTimeout(() => { window.location.replace(${JSON.stringify(targetUrl)}); }, 100);
  }
</script>
</body></html>`;
}

function renderEnvBuilder() {
  try {
    return fs.readFileSync(require("path").join(__dirname, "env-builder.html"), "utf8");
  } catch (exc) {
    return `<!doctype html><title>Env Builder unavailable</title><pre>${escapeHtml(exc.message)}</pre>`;
  }
}

// ── Generic proxy ──
function proxiedPath(url, { stripPrefix = "" } = {}) {
  if (!stripPrefix) return url.pathname + url.search;
  if (url.pathname === stripPrefix) return "/" + url.search;
  if (url.pathname.startsWith(stripPrefix + "/")) {
    return url.pathname.slice(stripPrefix.length) + url.search;
  }
  return url.pathname + url.search;
}

function rewriteProxyHeaders(headers, { publicPrefix = "", targetHost = "", targetPort = "" } = {}) {
  const next = { ...headers };

  // Keep browser redirects inside the public HF Space path. Backends may emit
  // root-relative redirects ("/login") or absolute redirects pointing at their
  // internal listener ("http://127.0.0.1:8888/..."). Both break from a browser
  // if we do not normalize them back to the public mount path.
  if (publicPrefix && typeof next.location === "string") {
    try {
      const internalOrigins = new Set([
        "http://openclaw-hf.local",
        `http://${targetHost}:${targetPort}`,
        `http://localhost:${targetPort}`,
        `http://127.0.0.1:${targetPort}`,
      ]);
      const location = new URL(next.location, "http://openclaw-hf.local");
      if (internalOrigins.has(location.origin)) {
        let path = location.pathname;
        if (path !== publicPrefix && !path.startsWith(publicPrefix + "/")) {
          path = publicPrefix + (path.startsWith("/") ? path : `/${path}`);
        }
        next.location = path + location.search + location.hash;
      }
    } catch {}
  }

  return next;
}

function sendServiceUnavailable(res) {
  if (!res.headersSent) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "starting", message: "Service is initializing… please wait." }));
  } else {
    res.end();
  }
}

function proxyHTTP(req, res, targetHost, targetPort, options = {}) {
  const url = parseRequestUrl(req.url);
  const headers = {
    ...req.headers,
    host: `${targetHost}:${targetPort}`,
    "x-forwarded-for": req.socket.remoteAddress,
    "x-forwarded-host": req.headers.host,
    "x-forwarded-proto": "https",
    "x-forwarded-prefix": options.publicPrefix || "",
    ...(options.extraHeaders || {}),
  };

  const canReplayRequest = req.method === "GET" || req.method === "HEAD";
  const proxyOnce = (path, retryOn404) => {
    const pr = http.request({ hostname: targetHost, port: targetPort, path, method: req.method, headers }, (pres) => {
      if (canReplayRequest && retryOn404 && pres.statusCode === 404 && options.stripPrefix) {
        pres.resume();
        return proxyOnce(proxiedPath(url, { stripPrefix: options.stripPrefix }), false);
      }
      res.writeHead(pres.statusCode, rewriteProxyHeaders(pres.headers, { ...options, targetHost, targetPort }));
      pres.pipe(res);
      pres.on("error", () => res.end());
    });
    req.on("error", () => pr.destroy());
    res.on("error", () => pr.destroy());
    pr.on("error", () => sendServiceUnavailable(res));
    req.pipe(pr);
  };

  // First try the public path as-is because OpenClaw and JupyterLab are both
  // configured with base paths. If a backend still returns 404, retry with the
  // mount prefix stripped; that covers images built before the base-path config
  // took effect and avoids the common HF Spaces "404 at /app or /terminal" trap.
  proxyOnce(url.pathname + url.search, !!options.retryWithoutPrefixOn404);
}

// ── HTTP server ──
const server = http.createServer(async (req, res) => {
  const { pathname } = parseRequestUrl(req.url);

  // Lightweight endpoint for client-side fallback detection.
  // Called by the dashboard JS if it suspects the server-rendered SPACE_IS_PRIVATE
  // value was stale (race condition at startup). No auth required — it's not sensitive.
  if (pathname === "/api/is-private") {
    if (!_privacyDetectionDone) await privacyDetectionReady;
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ isPrivate: SPACE_IS_PRIVATE }));
  }

  if (pathname === "/health") {
    const gatewayReady = await probePort(GATEWAY_HOST, GATEWAY_PORT, "/health");
    res.writeHead(gatewayReady ? 200 : 503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: gatewayReady ? "ok" : "degraded", gatewayReady, uptime: formatUptime(Date.now() - startTime), sync: getSyncStatus(), keepalive: getKeepaliveStatus() }));
  }

  if (pathname === "/status") {
    const [gatewayReady, jupyterReady] = await Promise.all([
      probePort(GATEWAY_HOST, GATEWAY_PORT, "/health"),
      JUPYTER_ENABLED ? probePort(JUPYTER_HOST, JUPYTER_PORT, `${JUPYTER_BASE}/login`) : Promise.resolve(false),
    ]);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ model: LLM_MODEL, uptime: formatUptime(Date.now() - startTime), gatewayReady, jupyterReady, sync: getSyncStatus(), whatsapp: readGuardianStatus(), keepalive: getKeepaliveStatus() }));
  }

  // Private space redirect — send users to the authenticated HF Spaces page.
  // Works for both direct .hf.space links AND programmatic shares.
  if (pathname === "/hf-redirect" || pathname === "/hf-redirect/") {
    if (HF_SPACE_URL) {
      res.writeHead(302, { Location: HF_SPACE_URL, "Cache-Control": "no-store" });
      return res.end();
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("SPACE_ID not configured.");
  }

  // ── Private Space Guard (server-side) ──
  // Triggers automatically when SPACE_IS_PRIVATE=true (detected via HF API at startup).
  // Only intercepts browser navigation (Accept: text/html) — API calls, assets,
  // and WebSocket upgrades pass through untouched.
  // /health and /status are always exempt so uptime monitors keep working.
  const isHtmlRequest = (req.headers.accept || "").includes("text/html");

  // RACE CONDITION FIX: Wait for privacy detection to finish BEFORE computing
  // isDirectHfSpaceRequest. Previously this const was computed immediately with
  // the fail-secure default (SPACE_IS_PRIVATE=true), causing private redirects
  // even when the space is actually public or the owner is accessing via HF App.
  // After the very first HTML request, _privacyDetectionDone=true so no delay.
  let privacyWaitTimedOut = false;
  if (isHtmlRequest && !_privacyDetectionDone) {
    const waitResult = await Promise.race([
      privacyDetectionReady.then(() => "detected"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), PRIVACY_DETECTION_WAIT_MS)),
    ]);
    privacyWaitTimedOut = waitResult == "timeout";
  }

  // In-app navigation (clicking links within the HF iframe) sends a Referer
  // from the same .hf.space origin — don't redirect those, only redirect
  // fresh direct browser access that has no same-origin referer.
  const referer = req.headers.referer || req.headers.referrer || "";
  const isSameOriginNav = !!(referer && typeof req.headers.host === "string" &&
    referer.startsWith(`https://${req.headers.host}`));
  // When HF App embeds the space in an iframe, the initial request has
  // Referer: https://huggingface.co/spaces/... (NOT .hf.space).
  // HF handles authentication itself — if the user is not logged in, HF
  // redirects them before the iframe ever loads. So a huggingface.co referer
  // means the user is already authenticated; skip the private redirect.
  const isFromHFApp = !!(referer && (
    referer.startsWith("https://huggingface.co") ||
    referer.startsWith("https://hf.co")
  ));
  // NOTE: computed AFTER detection is awaited above — always uses real value.
  const isDirectHfSpaceRequest = SPACE_IS_PRIVATE &&
    !privacyWaitTimedOut &&
    HF_SPACE_URL &&
    isHtmlRequest &&
    typeof req.headers.host === "string" &&
    req.headers.host.endsWith(".hf.space") &&
    !isSameOriginNav &&
    !isFromHFApp;

  if (pathname === LOGIN_PATH) {
    if (isAuthorized(req)) {
      const parsed = parseRequestUrl(req.url);
      const next = sanitizeNext(parsed.searchParams.get("next") || "/");
      res.writeHead(302, { Location: next, "Cache-Control": "no-store" });
      return res.end();
    }
    if (req.method === "GET") {
      const parsed = parseRequestUrl(req.url);
      const next = sanitizeNext(parsed.searchParams.get("next") || "/");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(renderLoginPage(next, false));
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const submittedToken = params.get("token") || "";
      const next = sanitizeNext(params.get("next") || "/");
      if (!GATEWAY_TOKEN || timingSafeEqualString(submittedToken, GATEWAY_TOKEN)) {
        res.writeHead(302, { Location: next, "Set-Cookie": buildSessionCookie(req), "Cache-Control": "no-store" });
        return res.end();
      }
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(renderLoginPage(next, true));
    }
    res.writeHead(405, { Allow: "GET, POST" });
    return res.end("Method Not Allowed");
  }

  if (pathname === "/logout") {
    res.writeHead(302, { Location: LOGIN_PATH, "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`, "Cache-Control": "no-store" });
    return res.end();
  }

  if (pathname === "/env-builder" || pathname === "/env-builder/") {
    if (isDirectHfSpaceRequest) {
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      return res.end(renderPrivateRedirect(HF_SPACE_URL));
    }
    if (!requireAuth(req, res)) return;
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(renderEnvBuilder());
  }

  if (pathname === "/env-builder.js") {
    if (!requireAuth(req, res)) return;
    try {
      const js = fs.readFileSync(require("path").join(__dirname, "env-builder.js"), "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
      return res.end(js);
    } catch (exc) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end(`env-builder.js not found: ${exc.message}`);
    }
  }

  if (pathname === "/" || pathname === "/dashboard") {
    // Detection already awaited above (in the isHtmlRequest guard) — no extra wait needed.
    if (isDirectHfSpaceRequest) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(renderPrivateRedirect(HF_SPACE_URL));
    }
    const gatewayReady = await probePort(GATEWAY_HOST, GATEWAY_PORT, "/health");
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(renderDashboard({
      uptimeHuman: formatUptime(Date.now() - startTime),
      gatewayReady,
      sync: getSyncStatus(),
      keepalive: getKeepaliveStatus(),
      authenticated: isAuthorized(req),
    }));
  }

  // JupyterLab terminal
  if (pathname === JUPYTER_BASE || pathname.startsWith(JUPYTER_BASE + "/")) {
    if (!JUPYTER_ENABLED) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "disabled", message: "JupyterLab terminal is disabled. Remove DEV_MODE=false to re-enable." }));
    }
    if (isDirectHfSpaceRequest) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(renderPrivateRedirect(HF_SPACE_URL));
    }
    if (!requireAuth(req, res)) return;
    // Inject the Jupyter token so JupyterLab skips its own login screen.
    // Mirror start.sh logic: JUPYTER_TOKEN falls back to GATEWAY_TOKEN when
    // unset or still the insecure default — that's what Jupyter was started with.
    const rawJupyterToken = (process.env.JUPYTER_TOKEN || "").trim();
    const jToken = (!rawJupyterToken || rawJupyterToken === "huggingface") ? GATEWAY_TOKEN : rawJupyterToken;
    return proxyHTTP(req, res, JUPYTER_HOST, JUPYTER_PORT, {
      publicPrefix: JUPYTER_BASE,
      // Jupyter is started with --ServerApp.base_url=/terminal/, so keep the
      // /terminal prefix when proxying. Stripping it breaks static/theme URLs.
      stripPrefix: "",
      retryWithoutPrefixOn404: false,
      extraHeaders: jToken ? { authorization: `token ${jToken}` } : {},
    });
  }

  // OpenClaw Control UI mounted under /app. Retry without the mount prefix on
  // 404 so deployments keep working across OpenClaw basePath behavior changes.
  if (pathname === APP_BASE || pathname.startsWith(APP_BASE + "/")) {
    if (isDirectHfSpaceRequest) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(renderPrivateRedirect(HF_SPACE_URL));
    }
    return proxyHTTP(req, res, GATEWAY_HOST, GATEWAY_PORT, {
      publicPrefix: APP_BASE,
      stripPrefix: APP_BASE,
      retryWithoutPrefixOn404: true,
    });
  }

  // Favicon — serve a minimal inline SVG so browsers don't proxy to the gateway
  if (pathname === "/favicon.ico" || pathname === "/favicon.svg") {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🦞</text></svg>';
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
    return res.end(svg);
  }

  // Landing page stylesheet
  if (pathname === "/static/style.css") {
    try {
      const css = fs.readFileSync(require("path").join(__dirname, "static", "style.css"), "utf8");
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      return res.end(css);
    } catch (exc) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end(`style.css not found: ${exc.message}`);
    }
  }

  // OpenClaw gateway API/static fallback (everything else)
  if (isDirectHfSpaceRequest) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(renderPrivateRedirect(HF_SPACE_URL));
  }
  proxyHTTP(req, res, GATEWAY_HOST, GATEWAY_PORT);
});

// ── WebSocket upgrade (JupyterLab kernels + terminals need this) ──
server.on("upgrade", (req, socket, head) => {
  const { pathname, search } = parseRequestUrl(req.url);
  const isJupyter = JUPYTER_ENABLED && (pathname === JUPYTER_BASE || pathname.startsWith(JUPYTER_BASE + "/"));
  const isApp = pathname === APP_BASE || pathname.startsWith(APP_BASE + "/");
  const [targetHost, targetPort] = isJupyter ? [JUPYTER_HOST, JUPYTER_PORT] : [GATEWAY_HOST, GATEWAY_PORT];
  const publicPrefix = isJupyter ? JUPYTER_BASE : isApp ? APP_BASE : "";
  const targetPath = pathname + search;

  const ps = net.connect(targetPort, targetHost, () => {
    ps.write(`${req.method} ${targetPath} HTTP/${req.httpVersion}\r\n`);
    ps.write(`Host: ${targetHost}:${targetPort}\r\n`);
    ps.write(`X-Forwarded-For: ${req.socket.remoteAddress || ""}\r\n`);
    ps.write(`X-Forwarded-Host: ${req.headers.host || ""}\r\n`);
    ps.write("X-Forwarded-Proto: https\r\n");
    if (publicPrefix) ps.write(`X-Forwarded-Prefix: ${publicPrefix}\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const header = req.rawHeaders[i];
      const lower = header.toLowerCase();
      if (["host", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-prefix"].includes(lower)) continue;
      ps.write(`${header}: ${req.rawHeaders[i + 1]}\r\n`);
    }
    ps.write("\r\n");
    if (head && head.length) ps.write(head);
    ps.pipe(socket).pipe(ps);
  });
  ps.on("error",     () => socket.destroy());
  ps.on("close",     () => socket.destroy());
  socket.on("error", () => ps.destroy());
  socket.on("close", () => ps.destroy());
});

server.timeout = 0;
server.keepAliveTimeout = 65000;
server.on("error", (err) => console.error(`[health-server] Server error:`, err));
server.listen(PORT, "0.0.0.0", () =>
  console.log(`🦞 OpenClaw :${PORT} → Gateway :${GATEWAY_PORT}${JUPYTER_ENABLED ? ` | Terminal :${JUPYTER_PORT} at ${JUPYTER_BASE}/` : " | Terminal disabled"}`),
);
