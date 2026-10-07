import { Link } from "react-router-dom";
import { Calculator, Target, CheckSquare, StickyNote, Table, Database, Wrench, ArrowUpRight } from "lucide-react";

const TOOLS = [
  {
    label: "Simulador",
    desc: "Simule empréstimos e veja rendimento em segundos.",
    path: "/ferramentas/simulador",
    icon: Calculator,
    tone: "from-cyan-500/20 to-cyan-500/5 text-cyan-300 ring-cyan-500/30",
  },
  {
    label: "Metas",
    desc: "Defina metas mensais e acompanhe o progresso.",
    path: "/ferramentas/metas",
    icon: Target,
    tone: "from-blue-500/20 to-blue-500/5 text-blue-300 ring-blue-500/30",
  },
  {
    label: "Tarefas",
    desc: "Organize o que precisa ser feito hoje.",
    path: "/ferramentas/tarefas",
    icon: CheckSquare,
    tone: "from-sky-500/20 to-sky-500/5 text-sky-300 ring-sky-500/30",
  },
  {
    label: "Anotações",
    desc: "Bloco de notas rápido para lembretes.",
    path: "/ferramentas/anotacoes",
    icon: StickyNote,
    tone: "from-amber-500/20 to-amber-500/5 text-amber-300 ring-amber-500/30",
  },
  {
    label: "Planilha",
    desc: "Área livre estilo planilha para cálculos.",
    path: "/ferramentas/planilha",
    icon: Table,
    tone: "from-indigo-500/20 to-indigo-500/5 text-indigo-300 ring-indigo-500/30",
  },
  {
    label: "Consulta CPF/CNPJ",
    desc: "Traga contratos e clientes de outro sistema.",
    path: "/puxada-dados",
    icon: Database,
    tone: "from-emerald-500/20 to-emerald-500/5 text-emerald-300 ring-emerald-500/30",
  },
];

const Ferramentas = () => (
  <div className="space-y-6 max-w-6xl mx-auto animate-fade-in">
    <div className="page-hero">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center shadow-[0_0_20px_hsl(var(--primary)/0.2)]">
          <Wrench size={22} className="text-primary" />
        </div>
        <div>
          <h1 className="text-headline text-2xl md:text-3xl text-foreground">Ferramentas</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Um só lugar com tudo que ajuda no seu dia a dia.
          </p>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {TOOLS.map(({ label, desc, path, icon: Icon, tone }) => (
        <Link
          key={path}
          to={path}
          className="group relative overflow-hidden rounded-2xl border border-border bg-card p-5 card-hover"
        >
          <div className={`absolute inset-0 bg-linear-to-br ${tone} opacity-40 group-hover:opacity-70 transition-opacity pointer-events-none`} />
          <div className="relative flex items-start justify-between">
            <div className={`w-11 h-11 rounded-xl bg-background/60 backdrop-blur-sm ring-1 flex items-center justify-center ${tone.split(" ").filter(c => c.startsWith("ring-") || c.startsWith("text-")).join(" ")}`}>
              <Icon size={20} />
            </div>
            <ArrowUpRight
              size={18}
              className="text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all"
            />
          </div>
          <div className="relative mt-4">
            <h3 className="text-base font-semibold text-foreground">{label}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
          </div>
        </Link>
      ))}
    </div>
  </div>
);

export default Ferramentas;
