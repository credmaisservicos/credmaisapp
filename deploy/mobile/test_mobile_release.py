import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('mobile-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_existing_compiler_image_is_reused(self):
        with patch.object(release.subprocess, 'run', return_value=MagicMock(returncode=0)) as run:
            release.ensure_builder_image()
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0], ['docker', 'image', 'inspect', release.BUILDER_IMAGE])

    def test_missing_compiler_is_rebuilt_without_private_build_context(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            (base / 'Dockerfile').write_text('FROM synthetic-test')
            (base / 'setup-sdk.py').write_text('# synthetic')
            (base / 'licenses').mkdir()
            (base / 'licenses' / 'android-sdk-license').write_text('synthetic')
            (base / 'config.json').write_text('private configuration excluded')
            (base / 'public').mkdir()
            (base / 'public' / 'CredMais.apk').write_bytes(b'old APK remains')
            def run(command, **kwargs):
                if command[1:3] == ['image', 'inspect']:
                    return MagicMock(returncode=1)
                context = Path(command[-1])
                self.assertEqual({p.name for p in context.iterdir()}, {'Dockerfile', 'setup-sdk.py', 'licenses'})
                self.assertTrue(kwargs['check'])
                return MagicMock(returncode=0)
            with patch.object(release, 'BASE', base), patch.object(release.subprocess, 'run', side_effect=run) as calls:
                release.ensure_builder_image()
            self.assertEqual(calls.call_count, 2)
            self.assertEqual((base / 'public' / 'CredMais.apk').read_bytes(), b'old APK remains')

    def test_compiler_failure_does_not_proceed_to_package_or_publish(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            for name in ('Dockerfile', 'setup-sdk.py'):
                (base / name).write_text('synthetic')
            (base / 'licenses').mkdir()
            failure = subprocess.CalledProcessError(1, ['docker', 'build'])
            with patch.object(release, 'BASE', base), patch.object(release.subprocess, 'run', side_effect=[MagicMock(returncode=1), failure]) as run, self.assertRaises(subprocess.CalledProcessError):
                release.ensure_builder_image()
            self.assertEqual(run.call_count, 2)

    def test_asset_requests_bypass_cached_html_fallback(self):
        def cached_response(request, timeout):
            response = MagicMock()
            response.__enter__.return_value = response
            fresh = '?mobile_release_check=' in request.full_url
            response.headers = {'Content-Type': 'text/javascript' if fresh else 'text/html'}
            response.read.return_value = b'app' if fresh else b'<html>old deploy</html>'
            return response

        with patch.object(release.urllib.request, 'urlopen', side_effect=cached_response) as request:
            content, mime = release.read_url('assets/app.js')
        item = {'path': 'assets/app.js', 'sha256': release.digest(b'app'), 'bytes': 3}
        self.assertEqual(release.verified_content(item, content, mime), b'app')
        self.assertEqual(request.call_args.args[0].get_header('Cache-control'), 'no-cache')

    def test_paths_stay_inside_build(self):
        for path in ['../secret', '/etc/passwd', 'a/../../secret', 'a\\secret', 'a//file', 'a/./file', None, 'a\0b']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                release.safe_path(path)
        self.assertEqual(release.safe_path('assets/app-hash.js'), 'assets/app-hash.js')

    def test_old_deploy_collects_all_vite_chunks(self):
        manifest = {'entry': {'file': 'assets/main.js', 'css': ['assets/main.css'], 'assets': ['assets/logo.png']}, 'lazy': {'file': 'assets/lazy.js'}}
        responses = [(b'<html>app</html>', 'text/html'), (json.dumps(manifest).encode(), 'application/json'), (b'<html>fallback</html>', 'text/html')]
        with patch.object(release, 'read_url', side_effect=responses):
            snapshot = release.snapshot({'publicPaths': ['manifest.json']})
        self.assertEqual({file['path'] for file in snapshot['files']}, {'index.html', 'vite-manifest.json', 'manifest.json', 'assets/main.js', 'assets/main.css', 'assets/logo.png', 'assets/lazy.js'})

    def test_catalog_rejects_deploy_changed_between_responses(self):
        files = [{'path': 'index.html', 'bytes': 3, 'sha256': release.digest(b'old')}]
        catalog = {'schema': 1, 'release': release.digest(json.dumps(files, separators=(',', ':')).encode()), 'files': files}
        with patch.object(release, 'read_url', side_effect=[(b'new', 'text/html'), (b'{}', 'application/json'), (json.dumps(catalog).encode(), 'application/json')]):
            with self.assertRaisesRegex(ValueError, 'original publicado'):
                release.snapshot({'publicPaths': []})

    def test_cloudflare_analytics_is_removed_only_when_original_hash_matches(self):
        html = b'<html>app</body></html>'
        injected = html.replace(b'</body>', b'<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/version" data-cf-beacon=\'{}\'></script>\n</body>')
        self.assertEqual(release.original_html(injected, release.digest(html)), html)
        self.assertEqual(release.original_html(html, release.digest(html)), html)

    def test_unknown_injected_script_is_rejected(self):
        html = b'<html>app</body></html>'
        injected = html.replace(b'</body>', b'<script src="https://outro.exemplo/app.js"></script></body>')
        with self.assertRaises(ValueError):
            release.original_html(injected, release.digest(html))

    def test_offline_html_is_validated_as_html(self):
        html = b'<html>offline</html>'
        item = {'path': 'offline.html', 'bytes': len(html), 'sha256': release.digest(html)}
        self.assertEqual(release.verified_content(item, html, 'text/html'), html)

    def test_javascript_html_fallback_and_wrong_asset_hash_are_rejected(self):
        for item, content, mime in [({'path': 'assets/app.js'}, b'<html>fallback</html>', 'text/html'), ({'path': 'assets/app.js', 'sha256': release.digest(b'app'), 'bytes': 3}, b'wrong', 'text/javascript')]:
            with self.assertRaises(ValueError):
                release.verified_content(item, content, mime)

    def test_publish_preserves_previous_apk_and_swaps_latest(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            public = base / 'public'
            public.mkdir()
            source = base / 'app.apk'
            source.write_bytes(b'first')
            with patch.object(release, 'BASE', base), patch.object(release, 'PUBLIC', public):
                web = {'release': 'one', 'fingerprint': 'fingerprint-one'}
                release.publish(source, web, 1, 'certificate')
                source.write_bytes(b'second')
                release.publish(source, {'release': 'two', 'fingerprint': 'fingerprint-two'}, 2, 'certificate')
            self.assertEqual((public / 'CredMais.apk').read_bytes(), b'second')
            self.assertEqual((public / 'versions/1/CredMais.apk').read_bytes(), b'first')
            self.assertEqual(json.loads((public / 'latest.json').read_text())['versionCode'], 2)


if __name__ == '__main__':
    unittest.main()
