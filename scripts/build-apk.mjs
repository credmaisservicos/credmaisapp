// Gera um APK Android de debug (instalável direto no celular, não assinado
// pra Play Store) num passo só: build do web, cap sync, gradle assembleDebug.
// Uso: npm run mobile:apk
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const isWin = process.platform === "win32";

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", shell: isWin, ...opts });
}

// JAVA_HOME: usa o já configurado no ambiente, ou tenta achar um JDK 21+
// instalado (Capacitor/AGP atuais exigem source release 21).
if (!process.env.JAVA_HOME) {
  const candidates = isWin
    ? [
        "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot",
        "C:\\Program Files\\Eclipse Adoptium",
      ]
    : [];
  const found = candidates.find((c) => existsSync(c) && /jdk-21/.test(c));
  if (found) {
    process.env.JAVA_HOME = found;
    console.log(`JAVA_HOME não estava definido — usando ${found}`);
  } else {
    console.error(
      "JAVA_HOME não está definido e nenhum JDK 21 conhecido foi encontrado.\n" +
      "Instale um JDK 21 (ex: winget install --id EclipseAdoptium.Temurin.21.JDK -e) e rode de novo,\n" +
      "ou defina JAVA_HOME manualmente antes de rodar este script.",
    );
    process.exit(1);
  }
}

run("npm", ["run", "build"]);
run("npx", ["cap", "sync", "android"]);

const androidDir = join(root, "android");
const gradlew = isWin ? join(androidDir, "gradlew.bat") : "./gradlew";
run(gradlew, ["assembleDebug", "--no-daemon"], { cwd: androidDir });

const apkSrc = join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
if (!existsSync(apkSrc)) {
  console.error(`Build terminou mas o APK não foi encontrado em ${apkSrc}`);
  process.exit(1);
}

const outDir = join(root, "dist-mobile");
mkdirSync(outDir, { recursive: true });
const apkOut = join(outDir, "CredMais.apk");
copyFileSync(apkSrc, apkOut);

console.log(`\n✓ APK gerado: ${apkOut}`);
