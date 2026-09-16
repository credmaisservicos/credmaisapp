import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  QrCode,
  Copy,
  Check,
  Download,
  Link2,
  ExternalLink,
  Share2,
  MessageCircle,
  Mail,
  Sparkles,
  ArrowUpRight,
  Users,
  Settings2,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import "@/qrcode-overrides.css";

type Preset = {
  key: string;
  label: string;
  desc: string;
  icon: typeof ExternalLink;
  path: string;
  accent: string; // tailwind gradient tokens
  tag: string;
};

const QRCodePage = () => {
  const [inputUrl, setInputUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState<256 | 400 | 600>(400);
  const [dark, setDark] = useState(true);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const presets: Preset[] = [
    {
      key: "cliente",
      label: "Portal do Cliente",
      desc: "Login por CPF, extrato e pagamento PIX",
      icon: Users,
      path: "/portal-cliente",
      accent: "from-primary/30 via-primary/10 to-transparent",
      tag: "Cliente",
    },
    {
      key: "cobrador",
      label: "Cobrador Externo",
      desc: "Painel operacional do cobrador",
      icon: Link2,
      path: "/cobrador-externo",
      accent: "from-amber-500/25 via-amber-500/5 to-transparent",
      tag: "Operacional",
    },
  ];

  const setUrl = (url: string) => {
    const candidate = url.trim();
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
      setActiveUrl(parsed.toString());
      setInputUrl(parsed.toString());
    } catch {
      toast.error("URL inválida", { description: "Use um endereço completo começando com http:// ou https://." });
    }
  };

  const handleCopy = async () => {
    if (!activeUrl) return;
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  const handleDownload = () => {
    if (!qrRef.current) return;
    try {
      const source = qrRef.current;
      const output = document.createElement("canvas");
      output.width = size;
      output.height = size;
      const context = output.getContext("2d");
      if (!context) throw new Error("canvas");
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 0, 0, size, size);
      const a = document.createElement("a");
      a.href = output.toDataURL("image/png");
      a.download = `qrcode-${size}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("QR Code baixado");
    } catch {
      toast.error("Não foi possível baixar o QR Code");
    }
  };

  const shareWhatsApp = () => {
    if (!activeUrl) return;
    const msg = encodeURIComponent(`Acesse: ${activeUrl}`);
    window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const shareEmail = () => {
    if (!activeUrl) return;
    const subject = encodeURIComponent("Link de acesso");
    const body = encodeURIComponent(`Acesse pelo link: ${activeUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const shareNative = async () => {
    if (!activeUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Acesso ao Portal", url: activeUrl });
      } catch {
        /* user cancelled */
      }
    } else {
      handleCopy();
    }
  };

  const activePreset = presets.find((p) => `${baseUrl}${p.path}` === activeUrl);

  return (
    <div className="qr-studio-page max-w-6xl mx-auto space-y-6 pb-12">
      {/* Hero */}
      <div className="qr-studio-hero relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/15 via-card to-card p-6 sm:p-8 animate-fade-in">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-10 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/30">
              <QrCode size={26} className="text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background/60 backdrop-blur-sm border border-border/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                <Sparkles size={11} className="text-primary" />
                QR Studio
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mt-1.5">
                Acesso rápido aos portais
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Gere, compartilhe e imprima QR Codes de qualquer link
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {presets.length} portais disponíveis
          </div>
        </div>
      </div>

      <div className="qr-studio-summary" aria-label="Resumo do QR Studio">
        <button type="button" className="qr-summary-card qr-summary-card--gold" onClick={() => setUrl(`${baseUrl}${presets[0].path}`)}>
          <span className="qr-summary-icon"><Zap size={16} /></span>
          <span><strong>{presets.length}</strong><small>portais prontos</small></span>
          <ArrowUpRight size={15} className="qr-summary-arrow" />
        </button>
        <div className="qr-summary-card">
          <span className="qr-summary-icon"><Settings2 size={16} /></span>
          <span><strong>{size}px</strong><small>tamanho de saída</small></span>
        </div>
        <div className="qr-summary-card qr-summary-card--green">
          <span className="qr-summary-icon"><ShieldCheck size={16} /></span>
          <span><strong>{activeUrl ? "Pronto" : "Aguardando"}</strong><small>{activeUrl ? "link validado" : "selecione um destino"}</small></span>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Left column: presets + custom */}
        <div className="lg:col-span-3 space-y-6">
          {/* Presets */}
          <section className="qr-panel qr-presets space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Links Rápidos
              </p>
              <p className="text-[11px] text-muted-foreground">Clique para gerar</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {presets.map((p) => {
                const Icon = p.icon;
                const fullUrl = `${baseUrl}${p.path}`;
                const isActive = activeUrl === fullUrl;
                return (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => setUrl(fullUrl)}
                    className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ${
                      isActive
                        ? "border-primary/50 bg-primary/5 shadow-lg shadow-primary/10"
                        : "border-border bg-card hover:border-primary/30 hover:-translate-y-0.5"
                    }`}
                  >
                    <div
                      className={`absolute inset-0 bg-gradient-to-br ${p.accent} opacity-60 pointer-events-none`}
                    />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105 ${
                            isActive
                              ? "bg-primary/20 text-primary"
                              : "bg-muted/60 text-muted-foreground"
                          }`}
                        >
                          <Icon size={18} />
                        </div>
                        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-background/60 border border-border/50 text-muted-foreground">
                          {p.tag}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-foreground mt-3">{p.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                        {p.desc}
                      </p>
                      <div className="flex items-center gap-1 mt-3 text-[10px] text-primary/80 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                        Gerar QR <ArrowUpRight size={11} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Custom URL */}
          <section className="qr-panel qr-custom space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              URL Personalizada
            </p>
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="flex items-center gap-2 flex-1 px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border/50 focus-within:border-primary/40 focus-within:bg-muted/60 transition-colors">
                  <Link2 size={15} className="text-muted-foreground shrink-0" />
                  <input
                    name="qr_custom_url"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && inputUrl && setUrl(inputUrl)}
                    placeholder="https://exemplo.com/pagina"
                    aria-label="URL para gerar o QR Code"
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
                <button
                    type="button"
                    onClick={() => inputUrl && setUrl(inputUrl)}
                  disabled={!inputUrl}
                  className="w-full px-5 py-2.5 rounded-xl text-sm font-bold text-primary-foreground disabled:opacity-40 transition-all hover:shadow-lg hover:shadow-primary/30 sm:w-auto"
                  style={{ background: "var(--gradient-button, hsl(var(--primary)))" }}
                >
                  Gerar
                </button>
              </div>

              {/* Options */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/40 border border-border/50">
                  {([256, 400, 600] as const).map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => setSize(s)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
                        size === s
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s}px
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/40 border border-border/50">
                  <button
                    type="button"
                    onClick={() => setDark(true)}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold transition-colors ${
                      dark
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Escuro
                  </button>
                  <button
                    type="button"
                    onClick={() => setDark(false)}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold transition-colors ${
                      !dark
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Claro
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="qr-howto rounded-2xl border border-border/60 p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="qr-howto-mark"><Check size={14} /></div>
              <p className="text-xs font-bold text-foreground">Um QR pronto para cada momento</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><span>01</span><p>Escolha o portal</p><small>Use um atalho pronto</small></div>
              <div><span>02</span><p>Personalize</p><small>Defina tamanho e contraste</small></div>
              <div><span>03</span><p>Compartilhe</p><small>Baixe ou envie direto</small></div>
            </div>
          </section>
        </div>

        {/* Right column: QR result */}
        <div className="lg:col-span-2">
          <div className="qr-result-panel lg:sticky lg:top-6 rounded-3xl border border-border bg-card overflow-hidden">
            {activeUrl ? (
              <>
                {/* QR preview */}
                <div
                  className={`flex justify-center p-8 ${
                    dark ? "bg-[#0f1115]" : "bg-white"
                  } transition-colors`}
                >
                  <div className="relative">
                    <div className="absolute -inset-4 rounded-3xl bg-primary/10 blur-2xl pointer-events-none" />
                    <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-white p-2">
                      <QRCodeCanvas
                        ref={qrRef}
                        value={activeUrl}
                        size={240}
                        level="H"
                        marginSize={2}
                        bgColor={dark ? "#0f1115" : "#ffffff"}
                        fgColor={dark ? "#ffffff" : "#0f1115"}
                        title="QR Code"
                        className="block"
                      />
                    </div>
                  </div>
                </div>

                {/* Info */}
                <div className="p-5 space-y-4 border-t border-border/50">
                  {activePreset && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Destino:</span>
                      <span className="font-bold text-foreground">
                        {activePreset.label}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 bg-muted/30 rounded-xl px-3 py-2.5 border border-border/40">
                    <Link2 size={14} className="text-muted-foreground shrink-0" />
                    <p className="text-xs text-foreground truncate flex-1 font-mono">
                      {activeUrl}
                    </p>
                    <button
                      onClick={handleCopy}
                      className="p-1.5 rounded-lg hover:bg-accent transition-colors shrink-0"
                      title="Copiar URL"
                    >
                      {copied ? (
                        <Check size={14} className="text-emerald-500" />
                      ) : (
                        <Copy size={14} className="text-muted-foreground" />
                      )}
                    </button>
                  </div>

                  <button
                    onClick={handleDownload}
                    className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-bold text-primary-foreground transition-all hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-0.5"
                    style={{ background: "var(--gradient-button, hsl(var(--primary)))" }}
                  >
                    <Download size={16} />
                    Baixar PNG
                  </button>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={shareWhatsApp}
                      className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-border bg-background hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors group"
                    >
                      <MessageCircle
                        size={16}
                        className="text-muted-foreground group-hover:text-emerald-500"
                      />
                      <span className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground">
                        WhatsApp
                      </span>
                    </button>
                    <button
                      onClick={shareEmail}
                      className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-colors group"
                    >
                      <Mail
                        size={16}
                        className="text-muted-foreground group-hover:text-primary"
                      />
                      <span className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground">
                        E-mail
                      </span>
                    </button>
                    <button
                      onClick={shareNative}
                      className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-colors group"
                    >
                      <Share2
                        size={16}
                        className="text-muted-foreground group-hover:text-primary"
                      />
                      <span className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground">
                        Compartilhar
                      </span>
                    </button>
                  </div>

                  <a
                    href={activeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors pt-1"
                  >
                    <ExternalLink size={12} />
                    Abrir link em nova aba
                  </a>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-10 min-h-[420px]">
                <div className="relative mb-5">
                  <div className="absolute inset-0 rounded-3xl bg-primary/20 blur-2xl" />
                  <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
                    <QrCode size={36} className="text-primary/70" />
                  </div>
                </div>
                <p className="text-sm font-bold text-foreground">
                  Nenhum QR gerado ainda
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[220px]">
                  Selecione um portal ao lado ou cole uma URL personalizada
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRCodePage;
