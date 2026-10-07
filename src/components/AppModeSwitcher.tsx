import { useNavigate } from "react-router-dom";
import { Shield, Store } from "lucide-react";
import { useAppMode, type AppMode } from "@/contexts/AppModeContext";

/**
 * Seletor entre o painel do dono do app e o app de operação.
 * Só aparece para admin da plataforma — para os demais o componente some.
 */
const AppModeSwitcher = ({ collapsed = false }: { collapsed?: boolean }) => {
  const { mode, setMode, canSwitch } = useAppMode();
  const navigate = useNavigate();

  if (!canSwitch) return null;

  const go = (next: AppMode) => {
    if (next === mode) return;
    setMode(next);
    navigate(next === "platform" ? "/admin" : "/dashboard");
  };

  const options: { value: AppMode; label: string; short: string; icon: typeof Shield }[] = [
    { value: "platform", label: "Plataforma", short: "Plataforma", icon: Shield },
    { value: "operation", label: "Minha operação", short: "Operação", icon: Store },
  ];

  if (collapsed) {
    const other = mode === "platform" ? options[1] : options[0];
    const OtherIcon = other.icon;
    return (
      <div className="mobile-mode-switcher px-2 pt-3">
        <button
          onClick={() => go(other.value)}
          title={`Ir para ${other.label}`}
          aria-label={`Ir para ${other.label}`}
          className="w-full h-9 rounded-lg bg-accent/30 hover:bg-accent/60 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <OtherIcon aria-hidden="true" size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 pt-3">
      <div
        role="tablist"
        aria-label="Modo do aplicativo"
        className="flex items-center gap-1 p-1 rounded-xl bg-accent/25 border border-border/25"
      >
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => go(opt.value)}
              className={`flex-1 flex items-center justify-center gap-1.5 h-7 rounded-lg text-[11px] font-semibold transition-[color,background-color,box-shadow] ${
                active
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              <Icon aria-hidden="true" size={12} />
              {opt.short}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AppModeSwitcher;
