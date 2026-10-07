import { Credinho } from "@/components/brand/Credinho";
import { ReactNode } from "react";
import { LucideIcon, Inbox } from "lucide-react";

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** Tamanho compacto para listas pequenas */
  compact?: boolean;
}

const EmptyState = ({ icon: Icon = Inbox, title, description, action, className = "", compact = false }: Props) => (
  <div
    role="status"
    className={`relative flex flex-col items-center justify-center overflow-hidden text-center ${compact ? "py-10 px-4" : "py-16 px-6"} ${className}`}
  >
    {!compact && <Credinho pose="thinking" className="credinho-empty" />}
    <div className={`${compact ? "w-12 h-12" : "w-16 h-16"} rounded-2xl bg-linear-to-br from-primary/10 to-primary/5 border border-primary/20 flex items-center justify-center mb-4 inset-shadow-sm`}>
      <Icon className={`${compact ? "w-5 h-5" : "w-7 h-7"} text-primary/70`} strokeWidth={1.5} />
    </div>
    <h3 className={`${compact ? "text-sm" : "text-base"} font-bold text-foreground`}>{title}</h3>
    {description && (
      <p className={`${compact ? "text-[11px]" : "text-xs"} text-muted-foreground mt-1.5 max-w-sm`}>
        {description}
      </p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export default EmptyState;
