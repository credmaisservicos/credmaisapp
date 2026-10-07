import { Credinho } from "@/components/brand/Credinho";
import { TrendingUp, TrendingDown, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";

export type BentoTone = "primary" | "success" | "danger" | "warning" | "info" | "muted";

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const toneMap: Record<BentoTone, { text: string; bg: string; border: string; grad: string }> = {
  primary: {
    text: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
    grad: "from-primary/25 via-primary/5 to-transparent",
  },
  success: {
    text: "text-success",
    bg: "bg-success/10",
    border: "border-success/20",
    grad: "from-success/25 via-success/5 to-transparent",
  },
  danger: {
    text: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
    grad: "from-destructive/25 via-destructive/5 to-transparent",
  },
  warning: {
    text: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/20",
    grad: "from-warning/25 via-warning/5 to-transparent",
  },
  info: {
    text: "text-info",
    bg: "bg-info/10",
    border: "border-info/20",
    grad: "from-info/25 via-info/5 to-transparent",
  },
  muted: {
    text: "text-foreground",
    bg: "bg-muted/40",
    border: "border-border/40",
    grad: "from-muted/40 via-muted/10 to-transparent",
  },
};

type Props = {
  label: string;
  value: string | number;
  /** Explicação em linguagem simples — abre em tooltip no ícone (?). */
  explanation?: string;
  /** Frase curta em linguagem simples logo abaixo do valor. */
  hint?: string;
  /** Variação % vs período anterior. */
  delta?: number;
  positiveIsGood?: boolean;
  tone?: BentoTone;
  icon?: React.ComponentType<any>;
  onClick?: () => void;
  /** Ocupa mais espaço no grid (Bento). */
  size?: "sm" | "md" | "lg";
  className?: string;
};

/**
 * Card KPI financeiro Bento — número grande + explicação em linguagem simples + comparativo.
 * Pensado para o dono/credor entender rapidamente o que o número significa.
 */
export default function BentoKPI({
  label,
  value,
  explanation,
  hint,
  delta,
  positiveIsGood = true,
  tone = "muted",
  icon: Icon,
  onClick,
  size = "md",
  className,
}: Props) {
  const reducedMotion = useReducedMotion();
  const t = toneMap[tone];
  const showDelta = typeof delta === "number" && isFinite(delta);
  const up = showDelta && (delta as number) >= 0;
  const good = showDelta && (positiveIsGood ? up : !up);
  const clickable = !!onClick;

  const sizeCls = {
    sm: "min-h-[120px] p-4",
    md: "min-h-[150px] p-5",
    lg: "min-h-[190px] p-6 md:col-span-2",
  }[size];

  const valueCls = {
    sm: "text-xl md:text-2xl",
    md: "text-2xl md:text-[28px]",
    lg: "text-3xl md:text-[42px]",
  }[size];

  return (
    <motion.button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card/45 text-left w-full transition-colors duration-200",
        t.border,
        sizeCls,
        clickable && "hover:bg-card/65 hover:border-primary/30 cursor-pointer",
        !clickable && "cursor-default",
        className
      )}
      whileHover={clickable && !reducedMotion ? { y: -4, scale: 1.01 } : undefined}
      whileTap={clickable && !reducedMotion ? { scale: 0.985 } : undefined}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
    >
      {size === "lg" && <Credinho pose={tone === "danger" || tone === "warning" ? "thinking" : tone === "success" ? "results" : "organize"} className="absolute right-5 top-2 w-[65px] opacity-40" />}
      {/* faixa gradient */}
      <div
        className={cn(
          "absolute inset-y-4 left-0 w-0.5 bg-linear-to-b opacity-70",
          t.grad
        )}
      />
      <div className={cn("pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-linear-to-br blur-2xl opacity-25 transition-opacity duration-300 group-hover:opacity-55", t.grad)} />
      <div className="relative z-10 flex flex-col justify-between h-full gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">
              {label}
            </span>
            {explanation && (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground/60 hover:text-muted-foreground cursor-help shrink-0"
                    >
                      <Info size={11} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
                    {explanation}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {Icon && (
            <div
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                t.bg
              )}
            >
              <Icon size={16} className={t.text} />
            </div>
          )}
        </div>

        <div className={size === "lg" ? "space-y-1 pr-16" : "space-y-1"}>
          <p
            className={cn("font-semibold tabular-nums leading-none", valueCls, t.text)}
            style={{ letterSpacing: "-0.025em", fontFeatureSettings: '"tnum","lnum"' }}
          >
            {value}
          </p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>

        {showDelta && (
          <div
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums self-start",
              good ? "text-success" : "text-destructive"
            )}
          >
            {up ? <TrendingUp size={11} strokeWidth={2.25} /> : <TrendingDown size={11} strokeWidth={2.25} />}
            {Math.abs(safeNumber(delta)).toFixed(1)}%
            <span className="text-muted-foreground/70 font-normal">vs anterior</span>
          </div>
        )}
      </div>
    </motion.button>
  );
}
