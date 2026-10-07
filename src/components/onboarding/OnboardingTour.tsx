import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface Step {
  selector?: string;
  route?: string;
  title: string;
  description: string;
  placement?: "bottom" | "top" | "left" | "right" | "center";
}

const STEPS: Step[] = [
  {
    title: "Bem-vindo ao CREDMAIS APP! 👋",
    description: "Vamos fazer um tour rápido pelas funcionalidades principais. Leva menos de 1 minuto.",
    placement: "center",
  },
  {
    selector: '[data-tour="dashboard"]',
    title: "Dashboard",
    description: "Aqui você acompanha KPIs, lucros e cobranças do dia.",
    placement: "right",
  },
  {
    selector: '[data-tour="clientes"]',
    title: "Clientes & Contratos",
    description: "Gerencie clientes, gere contratos com cálculo automático de parcelas e juros.",
    placement: "right",
  },
  {
    selector: '[data-tour="cobrancas"]',
    title: "Cobranças",
    description: "Visualize parcelas em Lista, Calendário ou Kanban. Envie cobranças em massa por WhatsApp, e-mail ou SMS.",
    placement: "right",
  },
  {
    selector: '[data-tour="simulador"]',
    title: "Simulador com IA",
    description: "Simule empréstimos e receba cenários alternativos sugeridos por IA (Conservador, Equilibrado, Lucrativo).",
    placement: "right",
  },
  {
    selector: '[data-tour="topbar-search"]',
    title: "Busca rápida (⌘K)",
    description: "Pressione ⌘+K (ou Ctrl+K) em qualquer página para buscar clientes, contratos e parcelas instantaneamente.",
    placement: "bottom",
  },
  {
    title: "Pronto para começar! 🚀",
    description: "Você pode revisitar este tour a qualquer momento em Configurações. Bom trabalho!",
    placement: "center",
  },
];

const STORAGE_KEY = "sj_onboarding_completed_v1";

export const useOnboardingTour = () => {
  const [open, setOpen] = useState(false);
  const start = useCallback(() => setOpen(true), []);
  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setOpen(true);
  }, []);
  return { open, start, reset, setOpen };
};

const OnboardingTour = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { user } = useAuth();
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const step = STEPS[stepIdx];

  useEffect(() => {
    if (!open || !step.selector) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector(step.selector!);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => setRect(el.getBoundingClientRect()), 200);
      } else {
        setRect(null);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, step]);

  const finish = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "1");
    if (user) {
      localStorage.setItem(`${STORAGE_KEY}_${user.id}`, "1");
      // Persist server-side so it never reappears on other devices/sessions
      supabase
        .from("profiles")
        .update({ onboarding_completed_at: new Date().toISOString() } as any)
        .eq("id", user.id)
        .then(() => {});
    }
    setStepIdx(0);
    onClose();
  }, [onClose, user]);

  if (!open) return null;

  const isCenter = step.placement === "center" || !rect;
  const tooltipStyle: React.CSSProperties = isCenter
    ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
    : (() => {
        const margin = 12;
        const w = 340;
        const h = 200;
        let top = rect!.bottom + margin;
        let left = rect!.left + rect!.width / 2 - w / 2;
        if (step.placement === "top") top = rect!.top - h - margin;
        if (step.placement === "right") {
          top = rect!.top + rect!.height / 2 - h / 2;
          left = rect!.right + margin;
        }
        if (step.placement === "left") {
          top = rect!.top + rect!.height / 2 - h / 2;
          left = rect!.left - w - margin;
        }
        left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
        top = Math.max(12, Math.min(top, window.innerHeight - h - 12));
        return { top, left, width: w };
      })();

  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-10000 animate-fade-in">
      {/* Dim overlay with cutout via SVG mask */}
      <svg className="absolute inset-0 w-full h-full pointer-events-auto" onClick={finish}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && !isCenter && (
              <rect
                x={rect.left - 6}
                y={rect.top - 6}
                width={rect.width + 12}
                height={rect.height + 12}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#tour-mask)" />
      </svg>

      {/* Highlighted ring */}
      {rect && !isCenter && (
        <div
          className="absolute pointer-events-none rounded-xl ring-2 ring-primary shadow-[0_0_24px_hsl(var(--primary)/0.6)] transition-all"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="absolute bg-card border border-primary/30 rounded-2xl p-5 shadow-2xl pointer-events-auto"
        style={tooltipStyle}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Sparkles size={14} className="text-primary" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Passo {stepIdx + 1} de {STEPS.length}
            </span>
          </div>
          <button onClick={finish} className="p-1 rounded-md hover:bg-accent text-muted-foreground" title="Pular tour">
            <X size={14} />
          </button>
        </div>

        <h3 className="text-base font-bold text-foreground mb-1.5">{step.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{step.description}</p>

        {/* Progress dots */}
        <div className="flex items-center gap-1 mb-4">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === stepIdx ? "w-6 bg-primary" : i < stepIdx ? "w-3 bg-primary/40" : "w-3 bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
            disabled={stepIdx === 0}
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed focus-ring"
          >
            <ChevronLeft size={12} /> Voltar
          </button>
          {stepIdx < STEPS.length - 1 ? (
            <button
              onClick={() => setStepIdx(stepIdx + 1)}
              className="flex items-center gap-1 text-xs font-semibold px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-95 focus-ring"
            >
              Próximo <ChevronRight size={12} />
            </button>
          ) : (
            <button
              onClick={finish}
              className="flex items-center gap-1 text-xs font-semibold px-4 py-1.5 rounded-lg bg-success text-success-foreground hover:opacity-90 active:scale-95 focus-ring"
            >
              Concluir 🎉
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

/** Auto-launches tour for new users on first dashboard visit */
export const OnboardingTourAuto = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Check server-side flag first (source of truth across devices)
      const { data } = await supabase
        .from("profiles")
        .select("onboarding_completed_at" as any)
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const serverCompleted = !!(data as any)?.onboarding_completed_at;
      if (serverCompleted) {
        localStorage.setItem(`${STORAGE_KEY}_${user.id}`, "1");
        return;
      }
      const localCompleted =
        localStorage.getItem(STORAGE_KEY) === "1" ||
        localStorage.getItem(`${STORAGE_KEY}_${user.id}`) === "1";
      if (localCompleted) {
        // Sync local → server so it never reappears
        await supabase
          .from("profiles")
          .update({ onboarding_completed_at: new Date().toISOString() } as any)
          .eq("id", user.id);
        return;
      }
      const t = setTimeout(() => !cancelled && setOpen(true), 1200);
      return () => clearTimeout(t);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return <OnboardingTour open={open} onClose={() => setOpen(false)} />;
};

export default OnboardingTour;
