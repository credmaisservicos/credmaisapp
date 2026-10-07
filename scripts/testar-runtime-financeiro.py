"""Start the real financial helpers in the production Edge Runtime image.

No application credentials, database connection, WhatsApp provider or published
public port are supplied. Only the synthetic quote fixture is copied into the container.
"""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent.parent
IMAGE = 'supabase/edge-runtime:v1.71.2'
EXPECTED = {'halfCent': 1.01, 'compound': 8.16, 'partialBalance': 102.01,
            'collectionAmount': 102.01, 'beforeBrazilMidnight': 0}


def run(*args, timeout=180):
    return subprocess.run(['docker', *args], capture_output=True, text=True,
                          check=True, timeout=timeout)


def main():
    name = 'credmais_financial_qa_' + uuid.uuid4().hex[:12]
    created = False
    with tempfile.TemporaryDirectory(prefix='credmais-financial-qa-') as folder:
        sandbox = Path(folder)
        (sandbox / 'main').mkdir()
        (sandbox / '_shared').mkdir()
        shutil.copyfile(ROOT / 'scripts/fixtures/financial-runtime/main/index.ts', sandbox / 'main/index.ts')
        for filename in ['bot_finance.ts', 'bot_collection.ts', 'financial_calendar.ts', 'financial_quote.ts']:
            shutil.copyfile(ROOT / 'supabase/functions/_shared' / filename, sandbox / '_shared' / filename)
        try:
            run('run', '--rm', '-d', '--name', name, '-p', '127.0.0.1::9000',
                '-v', str(sandbox) + ':/home/deno/functions:ro', IMAGE,
                'start', '--main-service', '/home/deno/functions/main')
            created = True
            metadata = json.loads(run('inspect', name).stdout)[0]
            port = metadata['NetworkSettings']['Ports']['9000/tcp'][0]['HostPort']
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                try:
                    with urllib.request.urlopen('http://127.0.0.1:' + port, timeout=2) as response:
                        result = json.load(response)
                    break
                except (OSError, ValueError):
                    time.sleep(.3)
            else:
                logs = subprocess.run(['docker', 'logs', name], capture_output=True, text=True)
                raise RuntimeError('Financial runtime did not start:\n' + (logs.stdout + logs.stderr)[-4000:])
            if result != EXPECTED:
                raise AssertionError('Financial runtime quote mismatch: ' + json.dumps(result))
            print(json.dumps({'image': IMAGE, 'actualBotHelpers': True, 'quotes': result,
                              'databaseCalls': 0, 'realMessages': 0}))
        finally:
            if created:
                run('stop', '--time', '1', name, timeout=15)


if __name__ == '__main__':
    main()
