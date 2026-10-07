// Debug é exclusivo de homologação. --release exige a assinatura persistente
// e um versionCode explícito para a distribuição aos clientes.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, isAbsolute } from "node:path";

const root = process.cwd();
const isWin = process.platform === "win32";
const release = process.argv.includes("--release");
const variant = release ? "release" : "debug";
const vite = join(root, "node_modules/vite/bin/vite.js");
const cap = join(root, "node_modules/@capacitor/cli/bin/capacitor");

if (release) {
  const required = ["KEYSTORE", "STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD", "VERSION_CODE"];
  const missing = required.filter((name) => !process.env[`CREDMAIS_ANDROID_${name}`]);
  if (missing.length) throw new Error(`Release exige: ${missing.map((name) => `CREDMAIS_ANDROID_${name}`).join(", ")}. Consulte docs/mobile-app.md.`);
  if (!isAbsolute(process.env.CREDMAIS_ANDROID_KEYSTORE) || !existsSync(process.env.CREDMAIS_ANDROID_KEYSTORE) || !statSync(process.env.CREDMAIS_ANDROID_KEYSTORE).isFile()) throw new Error("Configure o caminho absoluto do arquivo de assinatura Android existente.");
  if (!/^[1-9]\d*$/.test(process.env.CREDMAIS_ANDROID_VERSION_CODE)) throw new Error("Version code deve ser inteiro positivo.");
}

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", windowsHide: true, ...opts });
}

// JAVA_HOME: usa o já configurado no ambiente, ou tenta achar um JDK 21+
// instalado (Capacitor/AGP atuais exigem source release 21).
if (!process.env.JAVA_HOME) {
  const candidates = isWin
    ? ["C:\\Program Files\\Eclipse Adoptium", "C:\\Program Files\\Microsoft", join(process.env.USERPROFILE || "", ".jdks"), join(root, ".delivery.local")]
      .flatMap((directory) => existsSync(directory)
        ? readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(directory, entry.name)) : [])
    : [];
  const found = candidates.find((c) => existsSync(join(c, "bin", "java.exe")) && existsSync(join(c, "release")) && /JAVA_VERSION="21\./.test(readFileSync(join(c, "release"), "utf8")));
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

if (!process.env.ANDROID_HOME && !existsSync(join(root, "android", "local.properties"))) {
  const sdk = [join(root, ".delivery.local/android-sdk"), join(process.env.LOCALAPPDATA || "", "Android/Sdk")]
    .find((directory) => existsSync(join(directory, "platforms", "android-36", "android.jar")));
  if (!sdk) throw new Error("Android SDK 36 ausente. Configure ANDROID_HOME ou android/local.properties. Consulte docs/mobile-app.md.");
  process.env.ANDROID_HOME = sdk;
}

run(process.execPath, [vite, "build"]);
run(process.execPath, [cap, "sync", "android"]);

const androidDir = join(root, "android");
const java = join(process.env.JAVA_HOME, "bin", isWin ? "java.exe" : "java");
// Executa o mesmo wrapper via Java, sem shell nem concatenação de argumentos.
run(java, ["-Xmx64m", "-Xms64m", "-Dorg.gradle.appname=gradlew", "-classpath",
  join(androidDir, "gradle/wrapper/gradle-wrapper.jar"), "org.gradle.wrapper.GradleWrapperMain",
  release ? "assembleRelease" : "assembleDebug", "--no-daemon"], { cwd: androidDir });

const apkSrc = join(androidDir, "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);
if (!existsSync(apkSrc)) {
  console.error(`Build terminou mas o APK não foi encontrado em ${apkSrc}`);
  process.exit(1);
}

const outDir = join(root, "dist-mobile");
mkdirSync(outDir, { recursive: true });
const apkOut = join(outDir, release ? "CredMais.apk" : "CredMais-debug.apk");
copyFileSync(apkSrc, apkOut);

console.log(`\n✓ APK gerado: ${apkOut}`);
