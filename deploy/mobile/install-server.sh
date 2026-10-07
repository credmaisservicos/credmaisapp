#!/bin/bash
set -euo pipefail
umask 077
BASE=/opt/credmais-mobile
install -d -m 700 "$BASE" /root/.credmais/android-signing
install -d -m 755 "$BASE/public" "$BASE/public/versions"
install -d -m 700 "$BASE/project" "$BASE/gradle-cache"
tar -xzf /root/credmais-mobile-server.tar.gz -C "$BASE"
tar -xzf "$BASE/mobile-template.tar.gz" -C "$BASE/project"
# As origens Windows podem ter CRLF; os scripts executados no Linux usam LF.
sed -i 's/\r$//' "$BASE/project/build-release.sh" "$BASE/project/android/gradlew"
install -m 600 /root/credmais-mobile-config.json "$BASE/config.json"
docker build -t credmais-mobile-builder:1 "$BASE"
if ! docker container inspect credmais-downloads >/dev/null 2>&1; then
  docker run -d --name credmais-downloads --restart unless-stopped --memory=128m --cpus=0.5 \
    -p 172.16.0.1:3010:8080 \
    -v "$BASE/public:/releases:ro" -v "$BASE/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:stable-alpine
fi
docker exec credmais-downloads nginx -t
docker exec credmais-downloads nginx -s reload
install -m 644 "$BASE/traefik.yaml" /etc/easypanel/traefik/config/credmais-downloads.yaml
install -m 644 "$BASE/credmais-mobile-release.service" /etc/systemd/system/credmais-mobile-release.service
install -m 644 "$BASE/credmais-mobile-release.timer" /etc/systemd/system/credmais-mobile-release.timer
systemctl daemon-reload
echo 'Servidor de downloads e compilador preparados. Ative o timer após validar o primeiro APK.'
