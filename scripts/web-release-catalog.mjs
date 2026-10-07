import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Inventário público de arquivos do build para empacotar exatamente o web publicado.
export async function writeWebReleaseCatalog(directory) {
  const workerPath = join(directory, 'sw.js');
  try {
    const worker = await readFile(workerPath, 'utf8');
    if (worker.includes('__BUILD_ID__')) {
      await writeFile(workerPath, worker.replaceAll('__BUILD_ID__', Date.now().toString(36) + '-' + randomUUID().slice(0, 8)));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const files = [];
  async function visit(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile() && !['web-release.json', '_headers', '_redirects', '_worker.js', '_routes.json'].includes(item.name)) {
        const content = await readFile(path);
        files.push({ path: relative(directory, path).replaceAll('\\', '/'), bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
      }
    }
  }
  await visit(directory);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const release = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  await writeFile(join(directory, 'web-release.json'), JSON.stringify({ schema: 1, release, builtAt: new Date().toISOString(), files }));
  return { release, files };
}
