#!/bin/bash
set -euo pipefail
cd /build
LOCK_HASH=$(sha256sum package-lock.json | cut -d ' ' -f1)
if [ ! -d node_modules/@capacitor/android ] || [ "$(cat .npm-install.sha256 2>/dev/null || true)" != "$LOCK_HASH" ]; then
  npm ci --no-audit --no-fund
  printf '%s' "$LOCK_HASH" > .npm-install.sha256
fi
node node_modules/@capacitor/cli/bin/capacitor sync android
cd android
bash ./gradlew assembleRelease --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m'
APK=app/build/outputs/apk/release/app-release.apk
java -jar "$ANDROID_HOME/build-tools/36.0.0/lib/apksigner.jar" verify --verbose --print-certs "$APK"
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging "$APK"
