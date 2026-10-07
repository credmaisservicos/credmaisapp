"""Empacota o site publicado, assina e publica APKs sem tocar no banco do app."""
from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = Path('/opt/credmais-mobile')
PUBLIC = BASE / 'public'
PROJECT = BASE / 'project'
SITE = 'https://credmaisapp.com.br'
DOWNLOAD = 'https://credmaisapp-downloads.fcoipz.easypanel.host'
SIGNING = Path('/root/.credmais/android-signing')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def original_html(data, expected_hash):
    if digest(data) == expected_hash:
        return data
    # O Cloudflare injeta Web Analytics em algumas respostas HTML. Retira
    # somente esse script conhecido, e aceita apenas se o hash original bater.
    original = re.sub(rb'<script\b[^>]*\bsrc=["\']https://static\.cloudflareinsights\.com/beacon\.min\.js(?:/[^"\']*)?["\'][^>]*>[^<]*</script>[ \t]*\n?', b'', data)
    if digest(original) != expected_hash:
        raise ValueError('HTML não corresponde ao arquivo original publicado')
    return original


def safe_path(value):
    if not isinstance(value, str) or not value or any(ord(char) < 32 for char in value):
        raise ValueError('Caminho inválido no catálogo')
    path = PurePosixPath(value)
    if path.is_absolute() or '\\' in value or any(part in ('.', '..') for part in value.split('/')) or str(path) != value:
        raise ValueError('Caminho inválido no catálogo')
    return value


def verified_content(item, content, mime):
    path = safe_path(item['path'])
    if not path.lower().endswith('.html') and 'text/html' in mime:
        raise ValueError('Asset respondeu HTML: ' + path)
    if path.lower().endswith('.html') and 'sha256' in item:
        content = original_html(content, item['sha256'])
    if 'sha256' in item and (digest(content) != item['sha256'] or len(content) != item['bytes']):
        raise ValueError('Asset divergente: ' + path)
    return content


def read_url(path, limit=30 * 1024 * 1024, fresh=True):
    safe_path(path)
    url = SITE + '/' + urllib.parse.quote(path, safe='/')
    if fresh:
        # Durante a propagação de um deploy, a CDN pode manter o fallback HTML
        # de um asset novo. Evita esse cache também nos arquivos do APK.
        url += '?mobile_release_check=' + str(int(time.time()))
    request = urllib.request.Request(url, headers={'User-Agent': 'CredMaisRelease/1.0', 'Cache-Control': 'no-cache'} if fresh else {'User-Agent': 'CredMaisRelease/1.0'})
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError('Arquivo acima do limite de empacotamento')
        return data, response.headers.get('Content-Type', '')


def snapshot(config):
    html, _ = read_url('index.html', fresh=True)
    manifest_data, content_type = read_url('vite-manifest.json', fresh=True)
    if 'json' not in content_type:
        raise ValueError('Manifesto Vite não publicado')
    vite_manifest = json.loads(manifest_data)
    try:
        catalog_data, catalog_type = read_url('web-release.json', fresh=True)
        catalog = json.loads(catalog_data) if 'json' in catalog_type else None
    except (urllib.error.HTTPError, json.JSONDecodeError):
        catalog = None
    if catalog and catalog.get('schema') == 1:
        files = catalog['files']
        if not files or len(files) > 4000 or sum(item['bytes'] for item in files) > 300 * 1024 * 1024:
            raise ValueError('Tamanho inválido do catálogo')
        if len({item['path'] for item in files}) != len(files):
            raise ValueError('Caminhos duplicados no catálogo')
        for item in files:
            safe_path(item['path'])
            if not re.fullmatch('[a-f0-9]{64}', item['sha256']) or not isinstance(item['bytes'], int) or item['bytes'] < 0:
                raise ValueError('Hash ou tamanho inválido')
        expected_files = json.dumps(files, separators=(',', ':'), ensure_ascii=False).encode()
        if digest(expected_files) != catalog['release']:
            raise ValueError('Hash do catálogo inconsistente')
        index_entry = next(item for item in files if item['path'] == 'index.html')
        html = original_html(html, index_entry['sha256'])
        return {'release': catalog['release'], 'fingerprint': digest(catalog_data), 'files': files, 'html': html, 'catalog': catalog_data}
    # Publicações antigas também são acompanhadas. O manifesto do Vite inclui
    # todos os chunks e assets importados; os arquivos públicos vêm do template.
    paths = {'index.html', 'vite-manifest.json'} | set(config['publicPaths'])
    for entry in vite_manifest.values():
        paths.add(entry['file'])
        paths.update(entry.get('css', []))
        paths.update(entry.get('assets', []))
    return {'release': digest(html + manifest_data), 'fingerprint': digest(html + manifest_data), 'files': [{'path': safe_path(path)} for path in sorted(paths)], 'html': html, 'catalog': None}


def atomic_json(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2), encoding='utf-8')
    os.replace(temporary, path)


def publish(apk, web, version, certificate):
    target = PUBLIC / 'versions' / str(version) / 'CredMais.apk'
    target.parent.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(apk, target)
    target.chmod(0o644)
    target.parent.chmod(0o755)
    with target.open('rb') as content:
        checksum = hashlib.file_digest(content, 'sha256').hexdigest()
    temporary = PUBLIC / '.CredMais.apk.next'
    if temporary.is_symlink():
        temporary.unlink()
    temporary.symlink_to(target.relative_to(PUBLIC))
    os.replace(temporary, PUBLIC / 'CredMais.apk')
    metadata = {
        'packageName': 'br.com.credmais.app', 'versionCode': version,
        'versionName': '1.0.' + str(version - 1), 'webRelease': web['release'],
        'webFingerprint': web['fingerprint'], 'bytes': target.stat().st_size,
        'sha256': checksum, 'certificateSha256': certificate,
        'apkUrl': DOWNLOAD + '/CredMais.apk',
        'versionedApkUrl': DOWNLOAD + '/versions/' + str(version) + '/CredMais.apk',
        'publishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    atomic_json(PUBLIC / 'latest.json', metadata)
    (PUBLIC / 'latest.json').chmod(0o644)
    atomic_json(BASE / 'state.json', metadata)
    print('APK publicado:', version, checksum, flush=True)


def main():
    lock_file = (BASE / 'release.lock').open('a')
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    config = json.loads((BASE / 'config.json').read_text())
    web = snapshot(config)
    state_file = BASE / 'state.json'
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
    if state.get('webFingerprint') == web['fingerprint'] and (PUBLIC / 'CredMais.apk').exists():
        print('APK já acompanha o site publicado.', flush=True)
        return
    versions = [int(folder.name) for folder in (PUBLIC / 'versions').glob('*') if folder.name.isdecimal()]
    version = max(versions + [state.get('versionCode', 0)]) + 1
    if version > 2100000000:
        raise ValueError('Limite de versionCode atingido')
    dist = PROJECT / 'dist'
    if dist.exists():
        if not dist.resolve().is_relative_to(PROJECT.resolve()):
            raise ValueError('Diretório de build fora do projeto')
        shutil.rmtree(dist)
    dist.mkdir()

    def download(item):
        path = safe_path(item['path'])
        try:
            content, mime = read_url(path)
        except urllib.error.HTTPError as error:
            if web['catalog'] is None and path in config['publicPaths'] and error.code == 404:
                return
            raise
        if not path.lower().endswith('.html') and 'text/html' in mime:
            if web['catalog'] is None and path in config['publicPaths']:
                return
            raise ValueError('Asset respondeu HTML: ' + path)
        content = verified_content(item, content, mime)
        target = dist / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    print('Empacotando publicação:', web['release'], 'versão Android:', version, flush=True)
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(download, web['files']))
    if web['catalog']:
        (dist / 'web-release.json').write_bytes(web['catalog'])
    if snapshot(config)['fingerprint'] != web['fingerprint']:
        raise ValueError('Site mudou durante o empacotamento; tentará novamente')
    command = ['docker', 'run', '--rm', '--name', 'credmais-mobile-builder', '--cpus=1', '--memory=2g', '--memory-swap=2g',
        '--env-file', str(SIGNING / 'signing.env'),
        '-e', 'CREDMAIS_ANDROID_KEYSTORE=/signing/release.jks',
        '-e', 'CREDMAIS_ANDROID_VERSION_CODE=' + str(version),
        '-e', 'CREDMAIS_ANDROID_VERSION_NAME=1.0.' + str(version - 1),
        '-v', str(PROJECT) + ':/build', '-v', str(SIGNING / 'CredMais-release.jks') + ':/signing/release.jks:ro',
        '-v', str(BASE / 'gradle-cache') + ':/root/.gradle',
        'credmais-mobile-builder:1', 'bash', '/build/build-release.sh']
    log_path = BASE / 'last-build.log'
    with log_path.open('w') as log:
        subprocess.run(command, check=True, timeout=1500, stdout=log, stderr=subprocess.STDOUT)
    log = log_path.read_text()
    certificate = config['certificateSha256']
    if 'certificate SHA-256 digest: ' + certificate not in log:
        raise ValueError('Assinatura do APK não corresponde à chave preservada')
    if "package: name='br.com.credmais.app' versionCode='" + str(version) + "'" not in log or 'application-debuggable' in log:
        raise ValueError('Package, versão ou flag de debug inválidos')
    if snapshot(config)['fingerprint'] != web['fingerprint']:
        raise ValueError('Site mudou durante a compilação; APK não publicado')
    publish(PROJECT / 'android/app/build/outputs/apk/release/app-release.apk', web, version, certificate)


if __name__ == '__main__':
    main()
