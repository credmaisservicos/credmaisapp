"""Instala somente os pacotes usados pelo Gradle, com checksums do Google."""
import hashlib
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

repository = 'https://dl.google.com/android/repository/'
with urllib.request.urlopen(repository + 'repository2-1.xml', timeout=120) as response:
    document = ET.fromstring(response.read())
for package_name, destination in [('platforms;android-36', 'platforms/android-36'), ('build-tools;36.0.0', 'build-tools/36.0.0')]:
    package = next(item for item in document if item.tag.endswith('remotePackage') and item.attrib.get('path') == package_name)
    archive = next(item for item in package.findall('./archives/archive') if item.findtext('host-os') in (None, 'linux'))
    complete = archive.find('complete')
    archive_path = Path('/tmp') / complete.findtext('url')
    with urllib.request.urlopen(repository + complete.findtext('url'), timeout=120) as source, archive_path.open('wb') as output:
        while chunk := source.read(1024 * 1024):
            output.write(chunk)
    checksum = hashlib.sha1()
    with archive_path.open('rb') as content:
        while chunk := content.read(1024 * 1024):
            checksum.update(chunk)
    assert checksum.hexdigest() == complete.findtext('checksum')
    folder = Path('/opt/android-sdk') / destination
    folder.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as source:
        for entry in source.infolist():
            parts = Path(entry.filename).parts[1:]
            if not parts:
                continue
            target = folder.joinpath(*parts).resolve()
            assert target.is_relative_to(folder.resolve())
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read(entry))
                if entry.external_attr >> 16:
                    target.chmod(entry.external_attr >> 16)
    archive_path.unlink()
    print('Android SDK verificado:', package_name, flush=True)
