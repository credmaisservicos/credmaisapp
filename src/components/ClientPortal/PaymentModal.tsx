import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard, Copy, Check, QrCode, Receipt, Calendar,
  Download, Info, Loader2, MessageCircle, X, Upload
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { generatePortalReceiptPdf } from "@/utils/portalPdf";
import { QRCodeSVG } from "qrcode.react";
import { generatePixPayload } from "@/utils/pixGenerator";
import { formatBR, isOverdue as isDateOverdue } from "@/lib/dateUtils";
import { computeLateFee } from "@/lib/lateFee";
import { portalInstallmentAmount } from "@/lib/portalAmounts";

interface PaymentModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  installment: any;
  ownerProfile: any;
  clientData: any;
  contactPhone?: string | null;
  /** Token da sessão do portal — credencial do envio de comprovante. */
  sessionToken?: string | null;
}


export const PaymentModal = ({ isOpen, onOpenChange, installment, ownerProfile, clientData, contactPhone, sessionToken }: PaymentModalProps) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(installment?.receipt_url || null);

  const fmt = (v: number) => {
    const number = Number(v);
    return (Number.isFinite(number) ? number : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  };
  const isOverdue = installment?.status === "overdue" ||
    (installment && installment.status !== "paid" && isDateOverdue(installment.due_date));
  const isPaid = installment?.status === "paid";
  const alreadyPaid = Math.max(0, Number(installment?.paid_amount) || 0);

  const liveFee = useMemo(() => {
    if (!installment) return 0;
    return computeLateFee(installment);
  }, [installment]);

  const totalDue = useMemo(() => {
    if (!installment) return 0;
    return portalInstallmentAmount(installment);
  }, [installment, isPaid, liveFee]);

  const pixPayload = useMemo(() => {
    if (!installment || !ownerProfile?.pix_key || isPaid) return "";
    try {
      return generatePixPayload(
        ownerProfile.pix_key,
        totalDue,
        "SAO PAULO",
        ownerProfile.full_name || "CREDOR",
        `PARCELA ${installment.installment_number}`
      );
    } catch (e) {
      console.error("Erro ao gerar PIX", e);
      return "";
    }
  }, [ownerProfile, installment, isPaid, totalDue]);

  if (!installment) return null;


  const handleCopyPix = () => {
    const textToCopy = pixPayload || ownerProfile?.pix_key;
    if (!textToCopy) return;
    
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    toast({ 
      title: pixPayload ? "PIX Copia e Cola!" : "Chave PIX copiada!", 
      description: "Agora basta colar no seu banco para pagar." 
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNotifyPaid = () => {
    const phone = (contactPhone || "").replace(/\D/g, "");
    if (!phone) {
      toast({ title: "Sem WhatsApp do credor", description: "Entre em contato pelos canais informados.", variant: "destructive" });
      return;
    }
    // totalDue já reflete multa/juros vigentes e desconta qualquer pagamento
    // parcial já registrado — installment.amount sozinho é só o valor bruto
    // original e mandaria o credor um número desatualizado.
    const valor = (Number.isFinite(totalDue) ? totalDue : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const venc = formatBR(installment.due_date) || "data indisponível";
    const nome = clientData?.name || "Cliente";
    const msg = `Olá! Sou *${nome}* e acabei de efetuar o pagamento da parcela #${installment.installment_number} no valor de *${valor}* (venc. ${venc}). Segue o comprovante a seguir 👇`;
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  const handleDownloadReceipt = async () => {
    setIsDownloading(true);
    try {
      const client = {
        name: clientData?.name || "Cliente",
        cpf_cnpj: clientData?.cpf_cnpj || "000.000.000-00"
      };
      // await: a biblioteca de PDF agora é baixada sob demanda, então o aviso de
      // sucesso (e o `finally` que desliga o spinner) precisa esperar de verdade.
      await generatePortalReceiptPdf(client, installment, ownerProfile);
      toast({ title: "Recibo gerado!", description: "O download do PDF foi iniciado." });
    } catch (err) {
      toast({ title: "Erro", description: "Não foi possível gerar o recibo agora.", variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleUploadReceipt = async (file: File) => {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "O limite é 6MB.", variant: "destructive" });
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast({ title: "Formato inválido", description: "Envie JPG, PNG, WEBP ou PDF.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const chunks: string[] = [];
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
      }
      const base64 = btoa(chunks.join(""));
      const { data, error } = await supabase.functions.invoke("portal-upload-receipt", {
        body: {
          session_token: sessionToken ?? undefined,
          installment_id: installment.id,
          content_type: file.type,
          filename: file.name,
          file_base64: base64,
        },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      setUploadedUrl((data as any).url);
      toast({ title: "Comprovante enviado!", description: "O credor foi notificado e fará a conferência." });
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };


  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/70 p-3 "
      onClick={() => onOpenChange(false)}
      role="dialog"
      aria-label={`Detalhes da parcela ${installment.installment_number}`}
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-3xl bg-card  pb-[max(2rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-3 top-3 z-10 rounded-full p-2 text-background transition-colors hover:bg-white/10 hover:text-background"
          aria-label="Fechar"
        >
          <X size={18} />
        </button>

        <div className="p-6 bg-foreground text-background">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-background border-white/30 bg-white/10 uppercase tracking-widest text-[9px]">
              Parcela #{installment.installment_number}
            </Badge>
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              {isPaid ? <Receipt size={20} /> : <CreditCard size={20} />}
            </div>
          </div>
          <h2 className="text-2xl font-bold mt-2">R$ {fmt(totalDue)}</h2>
          {!isPaid && alreadyPaid > 0 ? (
            <p className="text-background text-xs">
              Você já pagou R$ {fmt(alreadyPaid)} desta parcela — falta R$ {fmt(totalDue)}
            </p>
          ) : !isPaid && liveFee > 0 ? (
            <p className="text-background text-xs">
              Parcela R$ {fmt(installment.amount)} + multa/juros R$ {fmt(liveFee)}
            </p>
          ) : null}
          <p className="text-background text-sm">
            {isPaid
              ? `Pago em ${formatBR(installment.paid_at) || "data indisponível"}`
              : `Vencimento em ${formatBR(installment.due_date) || "data indisponível"}`}
          </p>
        </div>

        <div className="p-6 space-y-6 bg-card">
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-4">
            <div className="space-y-1 min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Status</p>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${isPaid ? "bg-success" : isOverdue ? "bg-destructive" : "bg-muted-foreground"}`} />
                <span className="text-sm font-medium">{isPaid ? "Liquidado" : isOverdue ? "Em atraso" : "Aguardando"}</span>
              </div>
            </div>
            <div className="space-y-1 min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Data</p>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Calendar size={14} className="text-muted-foreground shrink-0" />
                <span className="truncate">{formatBR(installment.due_date) || "data indisponível"}</span>
              </div>
            </div>
          </div>

          {!isPaid ? (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-accent/30 border border-border space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <QrCode size={16} className="text-primary shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wide truncate">Pague com PIX</span>
                  </div>
                  <Badge variant="secondary" className="text-[9px] font-bold shrink-0">COPIA E COLA</Badge>
                </div>

                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="bg-white p-3 rounded-2xl border border-border shadow-xs">
                    {pixPayload ? (
                      <QRCodeSVG value={pixPayload} size={160} level="M" includeMargin={false} />
                    ) : (
                      <div className="w-32 h-32 bg-slate-100 flex items-center justify-center">
                        <QrCode size={80} className="text-slate-300" />
                      </div>
                    )}
                  </div>

                  <div className="w-full space-y-2 min-w-0">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase text-center">
                      {pixPayload ? "Código PIX Copia e Cola" : "Chave do Credor"}
                    </p>
                    <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-border p-2 rounded-xl min-w-0">
                      <code className="flex-1 min-w-0 text-[10px] font-mono font-medium truncate px-1 text-muted-foreground">
                        {pixPayload || ownerProfile?.pix_key || "carregando..."}
                      </code>
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg shrink-0" onClick={handleCopyPix}>
                        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleCopyPix}
                disabled={!pixPayload && !ownerProfile?.pix_key}
                className="w-full rounded-2xl py-7 text-base font-bold shadow-lg gap-2 active:scale-[0.98] transition-all"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
                {copied ? "Código copiado!" : "Copiar código PIX"}
              </Button>

              {contactPhone && (
                <Button
                  onClick={handleNotifyPaid}
                  variant="outline"
                  className="w-full rounded-2xl py-7 text-base font-semibold gap-2 border-success/40 text-success hover:bg-success/10 hover:text-success active:scale-[0.98] transition-all"
                >
                  <MessageCircle size={18} />
                  Já paguei — avisar credor no WhatsApp
                </Button>
              )}

              <div className="rounded-2xl border border-border/60 bg-accent/20 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Upload size={16} className="text-primary" />
                  <span className="text-xs font-bold uppercase tracking-wide">Enviar comprovante</span>
                </div>
                {uploadedUrl ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-success/30 bg-success/10 p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Check size={16} className="text-success shrink-0" />
                      <span className="text-xs text-success font-semibold truncate">Comprovante enviado</span>
                    </div>
                    <a href={uploadedUrl} target="_blank" rel="noreferrer" className="text-[10px] font-bold uppercase text-success underline shrink-0">Ver</a>
                  </div>
                ) : (
                  <>
                    <label
                      htmlFor="portal-receipt-upload"
                      className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 py-4 text-xs font-semibold text-primary transition hover:bg-primary/10 ${isUploading ? "pointer-events-none opacity-60" : ""}`}
                    >
                      {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                      {isUploading ? "Enviando..." : "Anexar foto/PDF do comprovante"}
                    </label>
                    <input
                      id="portal-receipt-upload"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      disabled={isUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadReceipt(f);
                        e.target.value = "";
                      }}
                    />
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      JPG, PNG, WEBP ou PDF — até 6MB. O credor recebe o arquivo para conferir o pagamento.
                    </p>
                  </>
                )}
              </div>

              <div className="flex items-start gap-2 p-3 rounded-xl bg-primary/5 border border-primary/10">
                <Info size={14} className="text-primary shrink-0 mt-0.5" />
                <p className="text-[10px] text-primary/80 leading-snug">
                  Após o pagamento, envie o comprovante ao credor para a baixa ser confirmada mais rápido.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-10 flex flex-col items-center justify-center text-center space-y-4 bg-success/5 rounded-3xl border border-success/10 border-dashed">
                <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center text-success">
                  <Check size={32} />
                </div>
                <div>
                  <h4 className="font-bold text-foreground">Pagamento Confirmado</h4>
                  <p className="text-xs text-muted-foreground">Esta parcela já foi quitada em nosso sistema.</p>
                </div>
              </div>

              <Button onClick={handleDownloadReceipt} disabled={isDownloading} className="w-full rounded-xl py-6 text-base font-bold gap-2">
                {isDownloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                Baixar recibo em PDF
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
