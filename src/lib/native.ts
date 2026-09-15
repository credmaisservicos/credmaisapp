/**
 * Ponte com o runtime nativo (Capacitor).
 *
 * O mesmo bundle roda em três lugares: navegador, PWA instalado e o APK/IPA
 * gerado pelo Capacitor. Só no último existe `window.Capacitor` — a WebView o
 * injeta antes do bundle carregar. Por isso a detecção abaixo lê o global em
 * vez de importar `@capacitor/core`: o build web não passa a carregar nada de
 * nativo só para descobrir que não é nativo.
 *
 * Os plugins entram por `import()` dentro de cada função, então o código deles
 * só é baixado no aparelho. E cada passo falha sozinho: se o APK foi gerado
 * sem rodar `npx cap sync`, o plugin não existe do lado nativo e a chamada
 * rejeita — isso não pode derrubar o app inteiro por causa de uma status bar.
 */

export type NativePlatform = "android" | "ios" | "web";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  platform?: string;
}

const capacitorGlobal = (): CapacitorGlobal | undefined =>
  (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;

export function nativePlatform(): NativePlatform {
  const cap = capacitorGlobal();
  if (!cap) return "web";
  const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : cap.platform;
  return platform === "android" || platform === "ios" ? platform : "web";
}

/** `true` só dentro do APK/IPA. PWA instalado continua sendo web. */
export const isNativeApp = (): boolean => nativePlatform() !== "web";

/**
 * Um plugin ausente é problema de empacotamento, não de uso — quem precisa do
 * aviso é quem gerou o build, e ele aparece no `npx cap run`/logcat.
 */
const avisarFalhaNativa = (etapa: string, erro: unknown) => {
  console.warn(`[nativo] ${etapa} indisponível:`, erro);
};

/** Fundo da status bar. Acompanha o splash nativo em `capacitor.config.ts`. */
const STATUS_BAR_ESCURA = "#08111d";
const STATUS_BAR_CLARA = "#ffffff";

/**
 * Pinta a status bar conforme o tema do app. Sem isso ela fica no valor do
 * `capacitor.config.ts` (escuro) e, no tema claro, some contra o fundo branco.
 */
export async function aplicarTemaNativo(theme: "light" | "dark"): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // No Capacitor, `Style.Dark` significa conteúdo claro sobre fundo escuro.
    await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light });
    if (nativePlatform() === "android") {
      await StatusBar.setBackgroundColor({
        color: theme === "dark" ? STATUS_BAR_ESCURA : STATUS_BAR_CLARA,
      });
    }
  } catch (erro) {
    avisarFalhaNativa("status bar", erro);
  }
}

/**
 * Some com o splash nativo. O `capacitor.config.ts` mantém um teto de tempo
 * como rede de segurança; aqui é o caminho normal — assim que o React monta, o
 * splash sai, em vez de ficar um tempo fixo por cima da tela já pronta.
 */
async function esconderSplashNativo(): Promise<void> {
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch (erro) {
    avisarFalhaNativa("splash screen", erro);
  }
}

/**
 * Marca no `<html>` que o teclado está aberto e quanto ele ocupa.
 *
 * Isto é o que impede a barra inferior (`position: fixed`) de cobrir o campo
 * que a pessoa está preenchendo: o CSS esconde a barra e o botão flutuante
 * enquanto `.keyboard-open` estiver presente.
 */
async function ligarTeclado(): Promise<void> {
  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    const raiz = document.documentElement;
    const abriu = (altura: number) => {
      raiz.style.setProperty("--keyboard-height", `${altura}px`);
      raiz.classList.add("keyboard-open");
    };
    const fechou = () => {
      raiz.style.removeProperty("--keyboard-height");
      raiz.classList.remove("keyboard-open");
    };
    // iOS dispara os eventos `will`; Android, os `did`. Registrar os dois
    // mantém um só caminho de código para as duas plataformas.
    await Keyboard.addListener("keyboardWillShow", (info) => abriu(info.keyboardHeight));
    await Keyboard.addListener("keyboardDidShow", (info) => abriu(info.keyboardHeight));
    await Keyboard.addListener("keyboardWillHide", fechou);
    await Keyboard.addListener("keyboardDidHide", fechou);
  } catch (erro) {
    avisarFalhaNativa("teclado", erro);
  }
}

let shellIniciado = false;

/**
 * Sobe o que é puramente visual do app nativo. Chamado uma vez, no boot.
 * No navegador retorna na primeira linha e nada é baixado.
 */
export async function iniciarShellNativo(): Promise<void> {
  if (shellIniciado || !isNativeApp()) return;
  shellIniciado = true;
  await ligarTeclado();
  const temaSalvo = localStorage.getItem("theme") === "light" ? "light" : "dark";
  await aplicarTemaNativo(temaSalvo);
  await esconderSplashNativo();
}

/** Fecha o app. Só faz sentido no Android, onde "voltar" na raiz sai mesmo. */
export async function sairDoAppNativo(): Promise<void> {
  try {
    const { App } = await import("@capacitor/app");
    await App.exitApp();
  } catch (erro) {
    avisarFalhaNativa("saída do app", erro);
  }
}

type Desinscrever = () => void;

/**
 * Liga o botão físico de voltar do Android. Sem isto, o comportamento padrão
 * da WebView é fechar o app de qualquer tela — inclusive com um modal aberto.
 */
export async function ouvirBotaoVoltar(
  aoVoltar: (podeVoltar: boolean) => void,
): Promise<Desinscrever> {
  if (nativePlatform() !== "android") return () => {};
  try {
    const { App } = await import("@capacitor/app");
    const inscricao = await App.addListener("backButton", ({ canGoBack }) => aoVoltar(canGoBack));
    return () => void inscricao.remove();
  } catch (erro) {
    avisarFalhaNativa("botão voltar", erro);
    return () => {};
  }
}

/**
 * Avisa quando o app volta do segundo plano.
 *
 * As consultas do app têm `refetchOnWindowFocus: false`, e a WebView nativa não
 * dispara foco de janela ao voltar — sem este gancho, quem deixa o app aberto e
 * retorna horas depois lê saldo e parcelas do cache.
 */
export async function ouvirRetomada(aoRetomar: () => void): Promise<Desinscrever> {
  if (!isNativeApp()) return () => {};
  try {
    const { App } = await import("@capacitor/app");
    const inscricao = await App.addListener("resume", aoRetomar);
    return () => void inscricao.remove();
  } catch (erro) {
    avisarFalhaNativa("retomada do app", erro);
    return () => {};
  }
}
