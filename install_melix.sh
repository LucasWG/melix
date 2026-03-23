#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/melix"
REPO_URL="https://github.com/LucasWG/melix.git"
DOMAIN="melix.debugzone.com.br"
EMAIL="admin@debugzone.com.br"
SERVER_PORT="3001"

echo "[melix] Atualizando sistema..."
sudo apt-get update -y
sudo apt-get upgrade -y

echo "[melix] Instalando dependencias base..."
sudo apt-get install -y curl git ca-certificates gnupg

if ! command -v node >/dev/null 2>&1; then
  echo "[melix] Instalando Node.js LTS..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[melix] Instalando pnpm..."
  sudo npm install -g pnpm
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[melix] Instalando PM2..."
  sudo npm install -g pm2
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "[melix] Instalando Caddy..."
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

if [ -d "$APP_DIR/.git" ]; then
  echo "[melix] Atualizando repositorio..."
  git -C "$APP_DIR" pull --rebase
else
  echo "[melix] Clonando repositorio..."
  sudo mkdir -p "$APP_DIR"
  sudo chown -R "$USER:$USER" "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "[melix] Instalando dependencias do servidor..."
cd "$APP_DIR/server"
pnpm install --frozen-lockfile=false
pnpm run build

echo "[melix] Configurando Caddy..."
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
${DOMAIN} {
  encode gzip
  reverse_proxy 127.0.0.1:${SERVER_PORT}
  tls ${EMAIL}
}
EOF

sudo systemctl restart caddy
sudo systemctl enable caddy

echo "[melix] Reiniciando PM2..."
pm2 delete melix >/dev/null 2>&1 || true
pm2 start dist/index.js --name melix --cwd "$APP_DIR/server"
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true

echo "[melix] Deploy concluido."

