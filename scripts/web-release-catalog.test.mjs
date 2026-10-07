import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeWebReleaseCatalog } from './web-release-catalog.mjs';

test('o catálogo inclui HTML, assets e seus hashes; repetir não inclui o próprio catálogo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'credmais-release-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), '<html>CredMais</html>');
    await writeFile(join(directory, '_headers'), 'metadata do Cloudflare, não publicado como asset');
    await writeFile(join(directory, 'sw.js'), 'const VERSION="credmais-__BUILD_ID__";');
    await writeFile(join(directory, 'assets', 'app.js'), 'console.log("app");');
    const first = await writeWebReleaseCatalog(directory);
    assert.deepEqual(first.files.map(file => file.path), ['assets/app.js', 'index.html', 'sw.js']);
    assert.ok(!(await readFile(join(directory, 'sw.js'), 'utf8')).includes('__BUILD_ID__'));
    for (const file of first.files) {
      const bytes = await readFile(join(directory, file.path));
      assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(file.bytes, bytes.length);
    }
    assert.equal((await writeWebReleaseCatalog(directory)).release, first.release);
    await writeFile(join(directory, 'assets', 'app.js'), 'console.log("nova versão");');
    assert.notEqual((await writeWebReleaseCatalog(directory)).release, first.release);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
