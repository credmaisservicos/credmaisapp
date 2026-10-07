"""Publicação inicial; atualizações posteriores são feitas pelo serviço."""
import importlib.util
import json
from pathlib import Path
import subprocess
import zipfile

base = Path('/opt/credmais-mobile')
spec = importlib.util.spec_from_file_location('release', base / 'mobile-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
apk = Path('/root/CredMais-initial.apk')
config = json.loads((base / 'config.json').read_text())
report = subprocess.check_output(['docker', 'run', '--rm', '--cpus=0.5', '--memory=512m', '-v', str(apk) + ':/app.apk:ro', 'credmais-mobile-builder:1', 'java', '-jar', '/opt/android-sdk/build-tools/36.0.0/lib/apksigner.jar', 'verify', '--verbose', '--print-certs', '/app.apk'], text=True)
assert 'certificate SHA-256 digest: ' + config['certificateSha256'] in report
with zipfile.ZipFile(apk) as archive:
    catalog_data = archive.read('assets/public/web-release.json')
catalog = json.loads(catalog_data)
release.publish(apk, {'release': catalog['release'], 'fingerprint': release.digest(catalog_data)}, 1, config['certificateSha256'])
