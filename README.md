---
title: OpenClaw
emoji: 🦞
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7861
pinned: false
license: mit
tags:
  - openclaw
  - terminal
  - llm-gateway
secrets:
  - name: LLM_MODEL
    description: "Model ID to use, e.g. google/gemini-2.5-flash or openai/gpt-4o."
  - name: LLM_API_KEY
    description: "Your LLM provider API key (e.g. Anthropic, OpenAI, Google, OpenRouter)."
  - name: GATEWAY_TOKEN
    description: "Strong token to secure your OpenClaw Control UI (generate: openssl rand -hex 32)."
  - name: CLOUDFLARE_WORKERS_TOKEN
    description: "Cloudflare API token — auto-creates a Worker proxy and KeepAlive monitor."
  - name: HF_TOKEN
    description: "HuggingFace token with Write access — enables automatic workspace backup."
  - name: TELEGRAM_ALLOWED_USERS
    description: "Comma-separated Telegram user IDs for access."
  - name: TELEGRAM_BOT_TOKEN
    description: "Telegram bot token from BotFather."
---

<!-- Badges -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![HF Space](https://img.shields.io/badge/🤗%20HuggingFace-Space-blue?style=flat-square)](https://huggingface.co/spaces)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Gateway-indigo?style=flat-square)](https://github.com/openclaw/openclaw)

**Your always-on AI assistant — free, no server needed.** This Space runs the official [OpenClaw](https://openclaw.ai) gateway plus a browser-based terminal on one HF Spaces port, giving you a 24/7 AI chat assistant on Telegram (with WhatsApp pairing also available). It works with *any* large language model (LLM) – Claude, ChatGPT, Gemini, etc. – and even supports custom models via [OpenRouter](https://openrouter.ai). Deploy in minutes on the free HF Spaces tier (2 vCPU, 16GB RAM, 50GB) with automatic workspace backup to a HuggingFace Dataset so your chat history and settings persist across restarts.

## Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [📱 Telegram Setup *(Optional)*](#-telegram-setup-optional)
- [🌐 Cloudflare Proxy *(Optional)*](#-cloudflare-proxy-optional)
- [💬 WhatsApp Setup *(Optional)*](#-whatsapp-setup-optional)
- [💾 Workspace Backup *(Optional)*](#-workspace-backup-optional)
- [📦 Ephemeral Package Re-install *(Optional)*](#-ephemeral-package-re-install-optional)
- [💓 Staying Alive](#-staying-alive-recommended-on-free-hf-spaces)
- [🔔 Webhooks *(Optional)*](#-webhooks-optional)
- [🔐 Security & Advanced *(Optional)*](#-security--advanced-optional)
- [🔑 API Key Rotation *(Optional)*](#-api-key-rotation-optional)
- [🤖 LLM Providers](#-llm-providers)
- [💻 Local Development](#-local-development)
- [🔗 CLI Access](#-cli-access)
- [💻 Browser Terminal](#-browser-terminal)
- [🏗️ Architecture](#-architecture)
- [🐛 Troubleshooting](#-troubleshooting)
- [📚 Links](#-links)
- [📄 License](#-license)

## ✨ Features

- 🔌 **Any LLM:** Use Claude, OpenAI GPT, Google Gemini, Grok, DeepSeek, Qwen, and 40+ providers (set `LLM_API_KEY` and `LLM_MODEL` accordingly).
- 🔑 **Multi-Key Rotation:** Supply comma-separated key pools per provider (e.g. `ANTHROPIC_API_KEYS=key1,key2,key3`) for automatic round-robin rotation across rate limits.
- ⚡ **Official Image:** Runs the official `ghcr.io/openclaw/openclaw` Docker image — no forked agent code.
- 🐳 **Fast Builds:** Pre-built base image deploys in minutes.
- 🌐 **Cloudflare Outbound Proxy:** Automatically provisions a Cloudflare Worker proxy for blocked outbound traffic such as Telegram API requests.
- 💾 **Workspace Backup:** Chats, settings, and WhatsApp session state sync to a private HF Dataset via the `huggingface_hub`, preserving data automatically without storing your HF token in a git remote.
- ⏰ **Easy Keep-Alive:** Uses `CLOUDFLARE_WORKERS_TOKEN` to automatically set up a cron-triggered keep-awake worker at boot.
- 👥 **Multi-User Messaging:** Support for Telegram (multi-user) and WhatsApp (pairing).
- 📊 **Visual Dashboard:** Lightweight landing page to monitor uptime, sync status, and active model — the native OpenClaw Control UI handles everything after you log in.
- 🔔 **Webhooks:** Get notified on restarts or backup failures via standard webhooks.
- 🔐 **Flexible Auth:** Secure the dashboard and Control UI with a gateway token.
- 💻 **Terminal Out of the Box:** A browser terminal is available at `/terminal/` automatically when `GATEWAY_TOKEN` is set — no extra config needed. It's protected by the same dashboard session auth as the Control UI. Set `DEV_MODE=false` explicitly to opt out.
- 🏠 **100% HF-Native:** Runs entirely on HuggingFace's free infrastructure (2 vCPU, 16GB RAM).

## 🚀 Quick Start

### Step 1: Duplicate this Space

[![Duplicate this Space](https://huggingface.co/datasets/huggingface/badges/resolve/main/duplicate-this-space-xl.svg)](https://huggingface.co/spaces/itanvirtuhin/Hf-OpenClaw?duplicate=true)

Click the button above to duplicate the template.

### Step 2: Add Your Secrets

Navigate to your new Space's **Settings**, scroll down to the **Variables and secrets** section, and add the following three under **Secrets**:

- `LLM_MODEL` – The model ID string you wish to use (e.g., `openai/gpt-4o` or `google/gemini-2.5-flash`).
- `LLM_API_KEY` – Your provider API key (e.g., Anthropic, OpenAI, OpenRouter).
- `GATEWAY_TOKEN` – A custom password or token to secure your Control UI. *(You can use any strong password, or generate one with `openssl rand -hex 32` if you prefer).*

> [!TIP]
> OpenClaw is completely flexible! You only need these three secrets to get started. The rest (Telegram, Cloudflare, HF backup) are optional and can be added later.

> [!NOTE]
> `TELEGRAM_MODE` defaults to `webhook` and `CLOUDFLARE_KEEPALIVE_ENABLED` defaults to `false` out of the box — no Variables needed for these. If you maintain your own template Space and want duplicators to see these explicitly pre-filled in **Settings → Variables and secrets**, add `TELEGRAM_MODE=webhook` and `CLOUDFLARE_KEEPALIVE_ENABLED=false` as Variables there yourself: Hugging Face copies a Space's current Variables (and Secret *names*, not values) into every duplicate. See [Staying Alive](#-staying-alive-recommended-on-free-hf-spaces) for why `CLOUDFLARE_KEEPALIVE_ENABLED` defaults to off.

**Terminal auto-enables when `GATEWAY_TOKEN` is set** — no extra secrets needed. The terminal is protected by the same dashboard session login as the Control UI. To disable the terminal entirely, set `DEV_MODE=false` as a Variable.

The Dockerfile tracks the latest upstream OpenClaw release by default. If you want to pin a specific version instead, add `OPENCLAW_VERSION` under **Variables** in your Space settings. For Docker Spaces, HF passes Variables as build args during image build, so these should be Variables, not Secrets (except tokens).

### Step 3: Deploy & Run

That's it! The Space will build the container and start up automatically. You can monitor the build process in the **Logs** tab.

### Step 4: Monitor & Manage

The landing page includes a live dashboard that tracks:

- **Gateway:** Whether the OpenClaw gateway is up and whether it's token-protected.
- **Model:** Which LLM and provider are currently powering your assistant.
- **Runtime:** Uptime and the public port.
- **Telegram:** Whether the bot is configured and reachable via webhook or polling.
- **Backup:** Workspace sync status against your HF Dataset.
- **Keep Awake:** Cloudflare keep-alive worker status.

Click **Open Agent** to go to the native OpenClaw Control UI — all chat, channel, and agent management happens there.

## 📱 Telegram Setup *(Optional)*

To chat via Telegram:

1. Create a bot via [@BotFather](https://t.me/BotFather): send `/newbot`, follow prompts, and copy the bot token.
2. Find your Telegram user ID with [@userinfobot](https://t.me/userinfobot).
3. Add `CLOUDFLARE_WORKERS_TOKEN` in Space secrets to let OpenClaw auto-provision the outbound proxy, or set `CLOUDFLARE_PROXY_URL` manually if you already have a Worker.
4. Add these secrets in Settings → Secrets. After restarting, the bot should appear online on Telegram.

| Variable | Default | Description |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token from BotFather |
| `TELEGRAM_ALLOWED_USERS` | — | Comma-separated Telegram user IDs for access |
| `TELEGRAM_MODE` | `webhook` | Set to `polling` to have OpenClaw long-poll Telegram instead of receiving updates via your Space's public URL |
| `TELEGRAM_WEBHOOK_URL` | *(derived from `SPACE_HOST`)* | Override the public webhook URL (only used when `TELEGRAM_MODE=webhook`) |
| `TELEGRAM_WEBHOOK_PATH` | `/telegram-webhook` | Path Telegram POSTs updates to (only used when `TELEGRAM_MODE=webhook`) |
| `TELEGRAM_WEBHOOK_SECRET` | *(auto-generated)* | Secret token Telegram includes on each request; OpenClaw validates it before processing |

`TELEGRAM_MODE` defaults to **webhook**: OpenClaw registers a webhook with Telegram, which POSTs updates directly to `https://<your-space>.hf.space/telegram-webhook` (or your `TELEGRAM_WEBHOOK_URL` override), and `health-server.js` forwards just that path to OpenClaw's webhook listener, which stays bound to `127.0.0.1` internally. Inbound webhook traffic counts as Space activity and resets HF's sleep timer, so regular bot usage alone helps keep a free-tier Space awake — with no ToS risk (see [Staying Alive](#-staying-alive-recommended-on-free-hf-spaces)). If `SPACE_HOST`/`TELEGRAM_WEBHOOK_URL` can't be determined, OpenClaw automatically falls back to long polling, which generates no inbound traffic to your Space. Set `TELEGRAM_MODE=polling` explicitly if you prefer that behavior.

## 🌐 Cloudflare Proxy Setup

Hugging Face's free tier often restricts outbound connections to services like Telegram, Discord, and WhatsApp. OpenClaw solves this with a **Transparent Outbound Proxy** via Cloudflare Workers.

> ⚠️ **ToS note:** This proxy is opt-in (it only activates if you set `CLOUDFLARE_WORKERS_TOKEN`) and only routes specific allowlisted third-party APIs — never Hugging Face or AI-provider traffic. Hugging Face's Content Policy prohibits using proxies/tunnels to bypass platform restrictions, and routing around an outbound network block could be read as falling under that policy even though this isn't targeting HF's own service. Enabling it is at your own risk under Hugging Face's Terms of Service.

### ⚡ Automatic Setup (Recommended)

This is the easiest way — OpenClaw handles the deployment for you.

1. Create a **Cloudflare API Token**:
   - Go to [API Tokens](https://dash.cloudflare.com/profile/api-tokens).
   - Create Token → **Edit Cloudflare Workers** template.
   - Ensure it has `Account: Workers Scripts: Edit` permissions.
2. Add the token as a secret named `CLOUDFLARE_WORKERS_TOKEN` in your Space Settings.

**What happens next?**

- A Worker named after your Space host is created automatically.
- A secure, private `CLOUDFLARE_PROXY_SECRET` is generated.
- All restricted outbound traffic is automatically routed through this Worker.

## 💬 WhatsApp Setup *(Optional)*

To use WhatsApp, enable the channel and scan the QR code from the Control UI (**Channels** → **WhatsApp** → **Login**):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `WHATSAPP_ENABLED` | `false` | Enable WhatsApp pairing support |

## 💾 Workspace Backup *(Optional)*

OpenClaw automatically syncs your workspace (chats, settings, sessions) to a private HF Dataset named `openclaw-hf-backup`.

- **Persistence:** Survives restarts and restores your state on boot.
- **WhatsApp:** Stores session credentials so you don't have to scan the QR code every time.
- **Interval:** Syncs every 3 minutes by default.

| Variable | Default | Description |
| :--- | :--- | :--- |
| `HF_TOKEN` | — | HF token with **Write** access |
| `BACKUP_DATASET_NAME` | `openclaw-hf-backup` | Backup dataset name (auto-created if missing) |
| `SYNC_INTERVAL` | `180` | Full backup frequency in seconds |
| `OPENCLAW_CONFIG_WATCH_INTERVAL` | `1` | How often to check `openclaw.json` for immediate settings sync |
| `OPENCLAW_CONFIG_SETTLE_SECONDS` | `3` | How long `openclaw.json` must stay valid and unchanged before syncing |
| `SESSIONS_MIN_SYNC_GAP` | `30` | Minimum seconds between session-triggered immediate syncs |

## 📦 Ephemeral Package Re-install *(Optional)*

Yes — you can use extra packages after a Space restart without storing package files. The easiest option is to remember **one variable**:

| Variable | What to put in it |
| :--- | :--- |
| `OPENCLAW_HF_RUN` | Any bash commands you want to run on every startup |

Example:

```bash
OPENCLAW_HF_RUN="""
set -e
sudo apt-get update
sudo apt-get install -y ffmpeg
python3 -m pip install --user pandas requests
npm install -g typescript
"""
```

For very quote-heavy or strange scripts, put a base64 script in the same variable:

```bash
# locally
base64 -w0 setup.sh

# HF Variable
OPENCLAW_HF_RUN=base64:<paste-output-here>
```

How it works:

1. `OPENCLAW_HF_RUN` is run as a full bash script on every boot before the OpenClaw gateway launches, so multi-line commands, `if`, loops, functions, and heredocs work. Long installs will delay gateway startup.
2. Startup scripts load the same OpenClaw shell wrappers as the interactive shell, so `apt install ...`, `pip install ...`, `npm install -g ...`, and `openclaw plugins install ...` behave consistently.
3. OpenClaw plugins installed at startup are synced into `plugins.allow` before the gateway launches, so the gateway can load them instead of reporting them as not installed.
4. If you install from the OpenClaw shell manually, the startup wrapper records only successful install commands in `/home/node/.openclaw/workspace/startup.sh` for replay. Failed or dummy commands are not saved by the wrapper.
5. Package files are not persisted; commands are replayed to reconstruct them after restart.

Errors are always printed as `ERROR:` lines in Space logs. By default the wrapper logs the error and continues booting; set `OPENCLAW_HF_STARTUP_STRICT=true` if the Space should fail fast when any startup install command fails.

Advanced/backward-compatible variables still work if you prefer package-specific fields: `OPENCLAW_HF_APT_PACKAGES`, `OPENCLAW_HF_PIP_PACKAGES`, `OPENCLAW_HF_NPM_PACKAGES`, `OPENCLAW_HF_PLUGINS`, `OPENCLAW_HF_STARTUP_COMMANDS`, `OPENCLAW_HF_STARTUP_COMMAND_1`...`100`, `OPENCLAW_HF_STARTUP_SCRIPT`, and `OPENCLAW_HF_STARTUP_SCRIPT_B64`.

> [!IMPORTANT]
> `sudo` is available for package-manager commands only (`apt`, `apt-get`, and `dpkg`). This is enough for `sudo apt-get update` and `sudo apt-get install -y ...`, but it is not unrestricted root access. Apt-installed packages still disappear on Space restart, so put them in `OPENCLAW_HF_RUN` or let the shell wrapper record the command in `startup.sh`.

## 💓 Staying Alive *(Recommended on Free HF Spaces)*

**Recommended: use the bot.** With `TELEGRAM_MODE=webhook` (the default — see [Telegram Setup](#-telegram-setup-optional)), Telegram POSTs updates straight to your Space, and that inbound traffic resets HF's sleep timer on its own. As long as the bot gets used periodically, the Space stays awake with zero extra setup and no ToS exposure.

**Optional, riskier: external keep-alive ping.** If you configure the `CLOUDFLARE_WORKERS_TOKEN` secret, OpenClaw can also deploy a background Cloudflare Worker that pings your Space's `/health` endpoint on a cron trigger. This is gated behind `CLOUDFLARE_KEEPALIVE_ENABLED`, which **defaults to `false`**.

> ⚠️ **ToS note:** Setting `CLOUDFLARE_KEEPALIVE_ENABLED=true` makes an external service repeatedly ping your Space purely to defeat HF's sleep timer. Hugging Face's Content Policy prohibits using platform resources to circumvent restrictions like the free-tier sleep behavior, so this carries a real risk of your Space (or account) being flagged or suspended. You *can* turn it on, but it's at your own risk under Hugging Face's Terms of Service — webhook-mode Telegram traffic is the safer way to keep a Space alive, since it's genuine usage rather than an artificial ping.

The dashboard displays the current keep-alive worker status either way.

## 🔔 Webhooks *(Optional)*

Get notified when your Space restarts or if a backup fails:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `WEBHOOK_URL` | — | Endpoint URL for POST JSON notifications |

## 🔐 Security & Advanced *(Optional)*

Configure password access and network restrictions:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OPENCLAW_PASSWORD` | — | Enable simple password auth instead of token (applies only when `GATEWAY_TOKEN` is empty) |
| `TRUSTED_PROXIES` | — | Comma-separated IPs of HF proxies |
| `ALLOWED_ORIGINS` | — | Comma-separated allowed origins for Control UI |
| `CLOUDFLARE_KEEPALIVE_ENABLED` | `false` | Set to `true` to enable the external Cloudflare keep-alive ping — at your own risk, see [Staying Alive](#-staying-alive-recommended-on-free-hf-spaces) |

## 🔑 API Key Rotation *(Optional)*

Spread requests across multiple API keys to avoid rate limits. Supply a comma-separated pool for any provider — keys rotate round-robin per provider independently.

```bash
# Single provider, multiple keys
ANTHROPIC_API_KEYS=sk-ant-key1,sk-ant-key2,sk-ant-key3

# Multiple providers simultaneously
OPENAI_API_KEYS=sk-openai-key1,sk-openai-key2
GEMINI_API_KEYS=AIza-key1,AIza-key2
```

**Fallback chain** (per provider):
1. `{PROVIDER}_API_KEYS` — comma-separated pool *(preferred)*
2. `{PROVIDER}_API_KEY` — single dedicated key
3. `LLM_API_KEY` — universal fallback *(enabled by default; disable with `LLM_API_KEY_FALLBACK_ENABLED=false`)*

> [!TIP]
> By default, `LLM_API_KEY` fallback is enabled for compatibility. Set `LLM_API_KEY_FALLBACK_ENABLED=false` if you want strict provider-only activation.

Supported per-provider variables: `ANTHROPIC_API_KEYS`, `OPENAI_API_KEYS`, `GEMINI_API_KEYS`, `DEEPSEEK_API_KEYS`, `GROQ_API_KEYS`, `MISTRAL_API_KEYS`, `OPENROUTER_API_KEYS`, `XAI_API_KEYS`, `NVIDIA_API_KEYS`, `COHERE_API_KEYS`, `TOGETHER_API_KEYS`, `CEREBRAS_API_KEYS`, and more — see `.env.example` for the full list.

## 🤖 LLM Providers

OpenClaw supports **all providers** from the upstream OpenClaw project. Set `LLM_MODEL=<provider/model>` and the provider is auto-detected.

<details>
<summary><b>Click to see supported providers and examples</b></summary>

| Provider | Prefix | Example Model |
| :--- | :--- | :--- |
| **Anthropic** | `anthropic/` | `anthropic/claude-sonnet-4-6` |
| **OpenAI** | `openai/` | `openai/gpt-5.4` |
| **Google** | `google/` | `google/gemini-2.5-flash` |
| **DeepSeek** | `deepseek/` | `deepseek/deepseek-v3.2` |
| **xAI (Grok)** | `xai/` | `xai/grok-4` |
| **Mistral** | `mistral/` | `mistral/mistral-large-latest` |
| **HuggingFace** | `huggingface/` | `huggingface/deepseek-ai/DeepSeek-R1` |
| **OpenRouter** | `openrouter/` | `openrouter/anthropic/claude-sonnet-4-6` |

*And many more: Cohere, Groq, NVIDIA, Moonshot, MiniMax, Z.ai/GLM, etc.*
</details>

### Any Other Provider

You can also use any custom provider:

```bash
LLM_API_KEY=your_api_key
LLM_MODEL=provider/model-name
```

The provider prefix in `LLM_MODEL` tells OpenClaw how to call it. See [OpenClaw Model Providers](https://docs.openclaw.ai/concepts/model-providers) for the full list.

### Custom OpenAI-Compatible Provider

Register a custom endpoint at startup without modifying the CLI.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CUSTOM_PROVIDER_NAME` | Unique provider prefix (e.g., `modal`) | **Required** |
| `CUSTOM_BASE_URL` | API base URL (e.g., `https://.../v1`) | **Required** |
| `CUSTOM_MODEL_ID` | Model ID on the server | **Required** |
| `LLM_MODEL` | Must match `{CUSTOM_PROVIDER_NAME}/{CUSTOM_MODEL_ID}` | **Required** |
| `CUSTOM_API_KEY` | Provider-specific key | `LLM_API_KEY` |
| `CUSTOM_CONTEXT_WINDOW` | Context limit | `128000` |

> [!TIP]
> `CUSTOM_PROVIDER_NAME` cannot override built-in providers (openai, anthropic, etc.).

**Example (Modal):**

```bash
CUSTOM_PROVIDER_NAME=modal
CUSTOM_BASE_URL=https://api.us-west-2.modal.direct/v1
CUSTOM_MODEL_ID=zai-org/GLM-5.1-FP8
LLM_MODEL=modal/zai-org/GLM-5.1-FP8
```

## 💻 Local Development

```bash
git clone https://github.com/itanvirt/hf-openclaw.git
cd hf-openclaw
cp .env.example .env
# Edit .env with your secret values
```

**With Docker:**

```bash
docker build --build-arg OPENCLAW_VERSION=latest -t openclaw-hf .
docker run -p 7861:7861 --env-file .env openclaw-hf
```

**Without Docker:**

```bash
npm install -g openclaw@latest
export $(cat .env | xargs)
bash start.sh
```

## 🔗 CLI Access

After deploying, you can connect via the OpenClaw CLI (e.g., to onboard channels or run agents):

```bash
npm install -g openclaw@latest
openclaw channels login --gateway https://YOUR_SPACE_NAME.hf.space
# When prompted, enter your GATEWAY_TOKEN
```

## 💻 Browser Terminal

The Space includes a browser-based terminal, backed by JupyterLab and reverse-proxied through the dashboard process:

| Path | Service | Notes |
| :--- | :--- | :--- |
| `/` | OpenClaw dashboard | Public HF Spaces entrypoint |
| `/app/` | OpenClaw Control UI (native) | Mounted behind the local reverse proxy |
| `/terminal/` | Browser terminal (JupyterLab) | Auto-enabled when `GATEWAY_TOKEN` is set; protected by the same dashboard session login as the Control UI. Set `DEV_MODE=false` to disable. |

When enabled, JupyterLab runs rooted at `$HOME` (`/home/node`), giving you a terminal plus a file browser and notebooks.

> [!IMPORTANT]
> No extra secret needed — the terminal reuses the dashboard's session login, so anyone who can authenticate to the dashboard can open a shell.

## 🏗️ Architecture

OpenClaw uses a multi-layered approach to ensure stability and persistence on Hugging Face's ephemeral infrastructure.

<details>
<summary><b>Click to view technical details</b></summary>

- **Dashboard (`/`)**: Landing page with status, monitoring, and keep-alive tools. Terminal button appears when DEV mode is enabled (default when `GATEWAY_TOKEN` is set).
- **Control UI (`/app/`)**: Native OpenClaw interface for managing agents and channels, proxied to the OpenClaw gateway on internal port `7860`.
- **Browser Terminal (`/terminal/`)**: JupyterLab, reverse-proxied by the dashboard process (auto-enabled when `GATEWAY_TOKEN` is set; set `DEV_MODE=false` to disable).
- **Health Check (`/health`)**: Endpoint for uptime monitoring and readiness probes.
- **Sync Engine**: Python background process managing HF Dataset persistence.
- **Transparent Proxy**: Interceptor for requests to blocked domains (Telegram, etc.).

**Startup sequence:**

1. Validate required secrets and check HF token.
2. Resolve backup namespace and restore workspace from HF Dataset.
3. Generate `openclaw.json` configuration.
4. Launch background tasks (auto-sync, channel helpers).
5. Start the local dashboard/reverse proxy and OpenClaw gateway (the browser terminal is available automatically when `GATEWAY_TOKEN` is set; set `DEV_MODE=false` to opt out).

</details>

## 🐛 Troubleshooting

- **Private Space 404:** If your Space is private, raw `https://<space>.hf.space/app/` or `/terminal/` links can show Hugging Face's own 404 page when opened outside the embedded App session. Open the Space's **App** tab first, then use the in-page dashboard buttons for `/app/` and `/terminal/`.
- **Terminal 404 or redirect loop:** Open `/terminal/` with the trailing slash from the dashboard/App tab and confirm `DEV_MODE` (or `OPENCLAW_HF_TERMINAL_ENABLED`) is set to enable it; log in to the dashboard first since the terminal requires the same session auth.
- **Control UI 404:** Open `/app/` with the trailing slash from the dashboard/App tab; the reverse proxy rewrites backend redirects into this mount path.
- **Missing secrets:** Ensure `LLM_MODEL`, `LLM_API_KEY`, and `GATEWAY_TOKEN` are set in your Space **Settings → Secrets**.
- **Telegram bot issues:** Verify your `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USERS`. Check Space logs for lines like `📱 Enabling Telegram`.
- **Backup restore failing:** Make sure `HF_TOKEN` is valid and has write access to your HF account dataset. Set `HF_USERNAME` only if auto-detection is not available in your environment.
- **Space keeps sleeping:** Add `CLOUDFLARE_WORKERS_TOKEN` as a Space secret to enable automatic keep-awake monitoring via Cloudflare Workers.
- **Auth errors / proxy:** If you see reverse-proxy auth errors, add the logged IPs under `TRUSTED_PROXIES` (from logs `remote=x.x.x.x`).
- **Control UI says too many failed authentication attempts:** Wait for the retry window to expire, then open the Space in an incognito window or clear site storage for your Space before logging in again with `GATEWAY_TOKEN`.
- **WhatsApp lost its session after restart:** Make sure `HF_TOKEN` is configured so the hidden session backup can be restored on boot.
- **UI blocked (CORS):** Set `ALLOWED_ORIGINS=https://your-space-name.hf.space`.
- **Version mismatches:** The Dockerfile tracks `latest` by default. If a new OpenClaw release regresses, pin a known-good version with the `OPENCLAW_VERSION` Variable in HF Spaces (or `--build-arg OPENCLAW_VERSION=...` locally) and rebuild (Factory reboot).

## 📚 Links

- [OpenClaw Docs](https://docs.openclaw.ai)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [HuggingFace Spaces Docs](https://huggingface.co/docs/hub/spaces)

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

*Self-hosted OpenClaw gateway for Hugging Face Spaces, by [Tanvir Tuhin](https://linkedin.com/in/itanvirtuhin).*
