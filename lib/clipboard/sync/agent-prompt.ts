// Prompt the user hands to a coding agent (Claude Code etc.): the agent prepares the R2 bucket with the `cf` CLI,
// walks the user through creating a bucket-scoped R2 token in the dashboard (the CLI's OAuth login cannot create
// API tokens), then prints a popMind sync key. Pure.
import type { AppLanguage } from '@/lib/capability/types'
import { DEFAULT_SYNC_BUCKET } from '@/lib/clipboard/sync/sync-key'

const BUILD_KEY_SCRIPT = `node -e 'const [a,b,k,s]=process.argv.slice(1);const e=require("crypto").randomBytes(32).toString("base64url");console.log("pmsync1."+Buffer.from(JSON.stringify({a,b,k,s,e})).toString("base64url"))' <ACCOUNT_ID> ${DEFAULT_SYNC_BUCKET} <ACCESS_KEY_ID> <SECRET_ACCESS_KEY>`

const zh = `请帮我为 popMind 剪贴板同步配置 Cloudflare R2，并生成一串「同步密钥」。

要求：
1. 只使用 Cloudflare 官方 \`cf\` CLI（没有就 \`npm i -g cf\`），不要用 wrangler。先用 \`cf cli search "<动作 + 资源>"\` 找命令，再看 \`<命令> --help\`。
2. 用 \`cf auth whoami\` 检查登录；没登录就停下来，让我在提示符输入 \`! cf auth login\`。
3. 确定账户 ID（有多个账户时问我用哪个）。
4. 存储桶名用 \`${DEFAULT_SYNC_BUCKET}\`，不存在就用 \`cf r2 buckets create\` 创建。如果已存在且里面有 \`meta/check\` 对象，说明已经有设备在同步：停下来告诉我「请在已同步的设备上打开 popMind → 设置 → 剪贴板 → 同步，复制同步密钥」，不要继续。
5. CLI 登录没有创建 API Token 的权限，所以这一步让我手动完成。请告诉我：
   - 打开 https://dash.cloudflare.com/<ACCOUNT_ID>/r2/api-tokens
   - 点「创建 Account API 令牌」，权限选「对象读和写」，「指定存储桶」只选 \`${DEFAULT_SYNC_BUCKET}\`，然后创建
   - 把页面上的「访问密钥 ID」和「机密访问密钥」发给你
6. 拿到这两个值后，运行下面的命令生成同步密钥（替换尖括号里的值；加密密钥在本机随机生成，Cloudflare 看不到）：
   ${BUILD_KEY_SCRIPT}
7. 最后只把以 \`pmsync1.\` 开头的那一行发给我，并提醒我：打开 popMind → 设置 → 剪贴板 → 同步，粘贴后点「连接」。不要在别处打印或保存机密访问密钥。`

const en = `Please set up Cloudflare R2 for popMind clipboard sync and produce a "sync key".

Requirements:
1. Use only the official Cloudflare \`cf\` CLI (install with \`npm i -g cf\` if missing), never wrangler. Find commands with \`cf cli search "<action + resource>"\`, then read \`<command> --help\`.
2. Check login with \`cf auth whoami\`; if not logged in, stop and ask me to run \`! cf auth login\`.
3. Determine the account ID (ask me if there are several accounts).
4. Use the bucket \`${DEFAULT_SYNC_BUCKET}\`; create it with \`cf r2 buckets create\` if missing. If it exists and contains a \`meta/check\` object, another device is already syncing: stop and tell me to copy the sync key on that device (popMind → Settings → Clipboard → Sync). Do not continue.
5. The CLI login cannot create API tokens, so I do this step by hand. Tell me to:
   - open https://dash.cloudflare.com/<ACCOUNT_ID>/r2/api-tokens
   - click "Create Account API token", choose "Object Read & Write", limit it to the bucket \`${DEFAULT_SYNC_BUCKET}\`, and create it
   - send you the "Access Key ID" and "Secret Access Key" shown on the page
6. Then build the sync key with this command (replace the angle-bracket values; the encryption key is generated locally, Cloudflare never sees it):
   ${BUILD_KEY_SCRIPT}
7. Reply with only the line starting with \`pmsync1.\` and remind me to open popMind → Settings → Clipboard → Sync, paste it and click "Connect". Do not print or store the secret access key anywhere else.`

export const buildAgentPrompt = (language: AppLanguage) => (language === 'en' ? en : zh)
