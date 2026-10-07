import { Link } from "react-router-dom";
import { SiteHeader, SiteFooter } from "@/components/site/SiteLayout";
import InstallAppCard from "@/components/InstallAppCard";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export default function DownloadApp() {
  const { isIOS, isAndroid } = usePwaInstall();
  return <div className="min-h-screen bg-[#0c0b09] text-white">
    <SiteHeader />
    <main className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Instalar aplicativo</h1>
      <p className="mt-4 text-sm leading-7 text-white/65">{isIOS
        ? "Instale o CredMais no seu iPhone ou iPad pelo Safari."
        : isAndroid ? "Instale o CredMais no seu Android e acesse sua conta pelo ícone do app."
        : "Instale o CredMais no seu computador ou notebook com Windows, macOS ou Linux e abra pelo ícone do app."}</p>
      <section className="dark mt-6" aria-label="Instalação no seu aparelho"><InstallAppCard showDownloadsLink={false} /></section>
      <Link to="/login" className="mt-7 inline-flex min-h-11 items-center text-sm font-semibold text-[#f5bd59]">Acessar minha conta</Link>
    </main>
    <SiteFooter />
  </div>;
}
