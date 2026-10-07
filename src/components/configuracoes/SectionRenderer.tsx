import React, { Suspense } from "react";
import type { SettingsCtx } from "./types";
import { Loader2 } from "lucide-react";

// Lazy-loaded sections
const EmpresaSection = React.lazy(() => import("./sections/EmpresaSection"));
const MarcaSection = React.lazy(() => import("./sections/MarcaSection"));
const PixSection = React.lazy(() => import("./sections/PixSection"));
const PadroesSection = React.lazy(() => import("./sections/PadroesSection"));
const NotificacoesSection = React.lazy(() => import("./sections/NotificacoesSection"));
const ModulosSection = React.lazy(() => import("./sections/ModulosSection"));
const PortalSection = React.lazy(() => import("./sections/PortalSection"));
const ContratoSection = React.lazy(() => import("./sections/ContratoSection"));
const AtendimentoSection = React.lazy(() => import("./sections/AtendimentoSection"));
const MensagemSection = React.lazy(() => import("./sections/MensagemSection"));
const WebhooksSection = React.lazy(() => import("./sections/WebhooksSection"));
const PwaSection = React.lazy(() => import("./sections/PwaSection"));

export const SECTION_IDS = [
  "empresa", "pix", "padroes", "notificacoes",
  "marca", "modulos", "portal", "contrato",
  "bot", "templates", "mensagem",
  "whatsapp", "webhooks", "pwa"
] as const;

export type SectionId = typeof SECTION_IDS[number];

export const SECTIONS: Record<SectionId, React.ComponentType<{ ctx: SettingsCtx }>> = {
  empresa: EmpresaSection,
  pix: PixSection,
  padroes: PadroesSection,
  notificacoes: NotificacoesSection,
  marca: MarcaSection,
  modulos: ModulosSection,
  portal: PortalSection,
  contrato: ContratoSection,
  bot: AtendimentoSection,
  templates: AtendimentoSection,
  mensagem: MensagemSection,
  whatsapp: AtendimentoSection,
  webhooks: WebhooksSection,
  pwa: PwaSection,
};

interface SectionRendererProps {
  tab: string;
  ctx: SettingsCtx;
}

const SectionRenderer = ({ tab, ctx }: SectionRendererProps) => {
  const Section = SECTIONS[tab as SectionId];

  return (
    <Suspense fallback={
      <div className="h-[400px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin opacity-20" />
      </div>
    }>
      {Section ? (
        <Section ctx={ctx} />
      ) : (
        <div className="p-12 text-center bg-muted/20 rounded-2xl border border-dashed border-border/50">
          <p className="text-sm text-muted-foreground">Seção "{tab}" não encontrada.</p>
        </div>
      )}
    </Suspense>
  );
};

export default SectionRenderer;
