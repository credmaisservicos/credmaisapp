#!/bin/bash
set -euo pipefail
BASE=/opt/credmais-mobile
exec 9>"$BASE/release.lock"
flock -w 1500 9
python3 - <<'PY'
import tarfile
with tarfile.open('/opt/credmais-mobile/mobile-template.next.tar.gz') as archive:
    archive.extractall('/opt/credmais-mobile/project', filter='data')
PY
sed -i 's/\r$//' "$BASE/project/build-release.sh" "$BASE/project/android/gradlew"
echo 'Template Android sincronizado; assinatura preservada.'
