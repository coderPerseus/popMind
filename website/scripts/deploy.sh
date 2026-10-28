#!/bin/bash
# Deploys the site to pm.luckysnail.cn: the Aliyun ECS server (Baota panel, nginx) reached with the
# Workbench CLI (workbench config, once). It builds, keeps a backup of what is live, replaces the files
# (keeping Baota's .user.ini and the certificates' .well-known), checks the live site, and tells the
# search engines. Run: bun run deploy
set -euo pipefail
cd "$(dirname "$0")/.."

INSTANCE="i-bp1awbfz2auektcwjtdk"
SITE="/www/wwwroot/pm.luckysnail.cn"
WB="${WORKBENCH:-$(command -v workbench || echo "$HOME/.local/bin/workbench")}"

bun run build
pkg="$(mktemp -d)/pm-site.tar.gz"
COPYFILE_DISABLE=1 tar --no-xattrs --exclude ./.vite --exclude ./.assetsignore --exclude ./_headers -czf "$pkg" -C dist/client .
"$WB" upload "$pkg" /tmp/ -i "$INSTANCE" -f

"$WB" exec -i "$INSTANCE" --timeout 120 -c "set -e
ts=\$(date +%Y%m%d-%H%M%S)
mkdir -p /www/backup/pm-site
tar czf /www/backup/pm-site/site-\$ts.tar.gz -C /www/wwwroot pm.luckysnail.cn
ls -t /www/backup/pm-site/site-*.tar.gz | tail -n +6 | xargs -r rm -f
rm -rf /tmp/pm-new && mkdir /tmp/pm-new && tar xzf /tmp/pm-site.tar.gz -C /tmp/pm-new --no-same-owner
rsync -a --delete --exclude .user.ini --exclude .well-known /tmp/pm-new/ $SITE/
chown www:www $SITE
find $SITE -mindepth 1 -not -name .user.ini -not -path '$SITE/.well-known*' -exec chown www:www {} +
rm -rf /tmp/pm-new /tmp/pm-site.tar.gz
echo deployed, backup site-\$ts.tar.gz"

bun run seo:check https://pm.luckysnail.cn
bun run seo:indexnow
