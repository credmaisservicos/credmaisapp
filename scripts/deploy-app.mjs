import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const root = process.cwd();
const mode = process.argv[2] || 'pages';
const preview = process.argv.includes('--preview');
const downloadOrigin = 'https://credmaisapp-downloads.fcoipz.easypanel.host';
const host = process.env.CREDMAIS_MOBILE_SSH_HOST || 'credmais-vps';
if (!/^[\w.@-]+$/.test(host)) throw new Error('Host SSH inválido.');
const run = (command, args) => execFileSync(command, args, { cwd: root, windowsHide: true, stdio: 'inherit' });
if (!['pages', 'worker'].includes(mode)) throw new Error('Use pages ou worker.');
if (!preview) {
  const response = await fetch(downloadOrigin + '/latest.json', { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  if (!response.ok) throw new Error('A distribuição Android precisa estar disponível antes de publicar.');
}

// Atualiza também o projeto nativo quando dependências, ícones ou plugins mudam.
// Publicações pelo painel Cloudflare são acompanhadas pelo timer independente.
if (!preview && !process.argv.includes('--no-template-sync')) {
  const directory = join(root, '.delivery.local');
  mkdirSync(directory, { recursive: true });
  const files = ['package.json', 'package-lock.json', 'capacitor.config.ts'];
  function walk(folder) {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      if (['build', '.gradle', 'assets', 'capacitor-cordova-android-plugins'].includes(entry.name) || entry.name === 'local.properties') continue;
      const path = folder + '/' + entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        if (/[\r\n]/.test(path)) throw new Error('Nome de arquivo nativo inválido.');
        files.push(path);
      }
    }
  }
  walk('android');
  const list = join(directory, 'mobile-template-list.txt');
  const archive = join(directory, 'mobile-template.tar.gz');
  writeFileSync(list, files.join('\n') + '\n');
  run('tar', ['-czf', archive, '-T', list]);
  run('scp', [archive, host + ':/opt/credmais-mobile/mobile-template.next.tar.gz']);
  run('ssh', [host, 'bash /opt/credmais-mobile/sync-template.sh']);
}

run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build']);
const catalog = readFileSync(join(root, 'dist/web-release.json'));
const expectedFingerprint = createHash('sha256').update(catalog).digest('hex');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Execute pelo npm run deploy:cloudflare.');
const args = mode === 'pages'
  ? ['pages', 'deploy', 'dist', '--project-name', 'credmaisapp', '--branch', preview ? 'codex-install-preview' : (process.env.CREDMAIS_PRODUCTION_BRANCH || 'feat/mobile-nativo-capacitor'), '--commit-dirty=true']
  : ['deploy'];
if (preview && mode !== 'pages') throw new Error('Preview é suportado pelo Cloudflare Pages.');
run(process.execPath, [npm, 'exec', '--yes', '--package=wrangler@4.147.0', '--', 'wrangler', ...args]);
if (preview) process.exit(0);
if (!process.argv.includes('--no-template-sync')) {
  run('ssh', [host, 'systemctl enable --now credmais-mobile-release.timer && systemctl start --no-block credmais-mobile-release.service']);
}

console.log('Site publicado. Aguardando o APK assinado da mesma publicação...');
const deadline = Date.now() + 30 * 60_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch(downloadOrigin + '/latest.json', { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    const latest = await response.json();
    if (response.ok && latest.webFingerprint === expectedFingerprint && latest.packageName === 'br.com.credmais.app' && latest.apkUrl === downloadOrigin + '/CredMais.apk') {
      console.log(`Publicação concluída: web + APK ${latest.versionName} (build ${latest.versionCode}). iPhone atualizado pelo app web.`);
      process.exit(0);
    }
  } catch (error) { console.log('Aguardando distribuição Android:', error.message); }
  console.log('Compilação Android em andamento; versão anterior continua disponível.');
  await setTimeout(30_000);
}
throw new Error('O site foi publicado, mas o APK ainda não acompanha este deploy. Verifique credmais-mobile-release.service no VPS.');
