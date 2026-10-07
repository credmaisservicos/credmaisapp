import { useState, useEffect } from "react";
import ExportCenter from "@/components/relatorios/ExportCenter";
import { Download, Calendar, TrendingUp, ArrowDownRight, Wallet, Users, Receipt, CheckCircle, AlertTriangle, Clock, BarChart3, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAll } from "@/lib/fetchAll";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatBR } from "@/lib/dateUtils";
import { reportableInstallments, summarizeReportInstallments } from "@/lib/reportMetrics";
import { buildMonthlyReportRange } from "@/lib/reportPeriod";

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const boundedRatio = (value: unknown, total: unknown) => {
  const denominator = safeNumber(total);
  if (denominator <= 0) return 0;
  return Math.min(100, Math.max(0, (safeNumber(value) / denominator) * 100));
};
const csvCell = (value: unknown) => {
  const raw = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};

const Relatorios = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [companySettings, setCompanySettings] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("settings").select("company_name, company_cnpj, company_logo_url").eq("user_id", user.id).single()
      .then(({ data }) => setCompanySettings(data));
  }, [user]);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const fetchReport = async () => {
    if (!user) return;
    setLoading(true);
    setReportError(null);
    const range = buildMonthlyReportRange(month);
    if (!range) {
      setData(null);
      setReportError("Selecione um mês válido.");
      setLoading(false);
      return;
    }
    const { startDay, endDay, startDateTime, endDateTime } = range;

    try {
    const [profitData, expenseData, clientData, installmentDataRaw, receivedInstallments, contractsRaw] = await Promise.all([
      fetchAll((f, t) => supabase.from("profits").select("*").eq("user_id", user.id).gte("date", startDateTime).lte("date", endDateTime).range(f, t)),
      fetchAll((f, t) => supabase.from("expenses").select("*").eq("user_id", user.id).gte("date", startDateTime).lte("date", endDateTime).range(f, t)),
      fetchAll((f, t) => supabase.from("clients").select("*").eq("user_id", user.id).range(f, t)),
      fetchAll((f, t) => supabase.from("contract_installments").select("*").eq("user_id", user.id).gte("due_date", startDay).lte("due_date", endDay).range(f, t)),
      fetchAll((f, t) => supabase.from("contract_installments").select("id,amount,paid_amount,paid_at,status").eq("user_id", user.id).eq("status", "paid").gte("paid_at", startDateTime).lte("paid_at", endDateTime).range(f, t)),
      fetchAll((f, t) => supabase.from("contracts").select("id,status").eq("user_id", user.id).range(f, t)),
    ]);

    // Mantém parcelas de contratos já quitados no mês e remove cancelamentos;
    // assim o último pagamento não desaparece depois da quitação.
    const installmentData = reportableInstallments(installmentDataRaw, contractsRaw);

    const totalProfit = profitData.reduce((a: number, p: any) => a + safeNumber(p.amount), 0);
    const totalExpense = expenseData.reduce((a: number, e: any) => a + safeNumber(e.amount), 0);
    const totalReceived = receivedInstallments.reduce((a: number, i: any) => a + safeNumber(i.paid_amount ?? i.amount), 0);
    const installmentSummary = summarizeReportInstallments(installmentData);

    setData({
      profitData, expenseData, clientData, installmentData,
      totalProfit, totalExpense, totalReceived, totalOverdue: installmentSummary.totalOverdue,
      paidCount: installmentSummary.paidCount,
      overdueCount: installmentSummary.overdueCount,
      pendingCount: installmentSummary.pendingCount,
      activeClients: clientData.filter((c: any) => c.status === "Ativo").length,
      balance: totalProfit - totalExpense,
    });
    } catch (error) {
      setData(null);
      setReportError(error instanceof Error ? error.message : "Não foi possível gerar o relatório.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    fetchReport(); 
    
  }, [user, month]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("realtime-relatorios")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "profits", filter: `user_id=eq.${user.id}` }, () => fetchReport())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "expenses", filter: `user_id=eq.${user.id}` }, () => fetchReport())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "contract_installments", filter: `user_id=eq.${user.id}` }, () => fetchReport())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "contracts", filter: `user_id=eq.${user.id}` }, () => fetchReport())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "clients", filter: `user_id=eq.${user.id}` }, () => fetchReport())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, month]);

  const monthLabel = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  })();

  const handleExportCSV = () => {
    if (!data) return;
    let csv = "RELATÓRIO MENSAL;" + csvCell(monthLabel.toUpperCase()) + "\r\n\r\n";
    csv += "RESUMO\r\n";
    csv += `Lucro Total;${safeNumber(data.totalProfit).toFixed(2).replace(".", ",")}\r\n`;
    csv += `Gastos Total;${safeNumber(data.totalExpense).toFixed(2).replace(".", ",")}\r\n`;
    csv += `Saldo;${safeNumber(data.balance).toFixed(2).replace(".", ",")}\r\n`;
    csv += `Recebido (parcelas);${safeNumber(data.totalReceived).toFixed(2).replace(".", ",")}\r\n`;
    csv += `Em atraso;${safeNumber(data.totalOverdue).toFixed(2).replace(".", ",")}\r\n\r\n`;

    csv += "LUCROS\r\nData;Descrição;Valor\r\n";
    (data.profitData || []).forEach((p: any) => {
      csv += `${csvCell(formatBR(p.date))};${csvCell(p.description)};${safeNumber(p.amount).toFixed(2).replace(".", ",")}\r\n`;
    });
    csv += "\r\nGASTOS\r\nData;Descrição;Categoria;Valor\r\n";
    (data.expenseData || []).forEach((e: any) => {
      csv += `${csvCell(formatBR(e.date))};${csvCell(e.description)};${csvCell(e.category || "-")};${safeNumber(e.amount).toFixed(2).replace(".", ",")}\r\n`;
    });

    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: "✓ Relatório exportado!" });
  };

  const handleExportPDF = async () => {
    if (!data) return;
    try {
      const doc = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();
      const companyName = companySettings?.company_name || profile?.name || "Sistema Juros";

      // Header com gradient simulado
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 42, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18); doc.setFont("helvetica", "bold");
      doc.text(companyName, 14, 16);
      doc.setFontSize(11); doc.setFont("helvetica", "normal");
      doc.text("Relatório Financeiro Mensal", 14, 24);
      doc.setFontSize(8);
      doc.text(`Período: ${monthLabel}  |  Emitido em ${new Date().toLocaleString("pt-BR")}`, 14, 32);
      if (companySettings?.company_cnpj) doc.text(`CNPJ: ${companySettings.company_cnpj}`, 14, 38);

      let y = 52;
      doc.setTextColor(40, 40, 40);
      doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text("Resumo Financeiro", 14, y); y += 2;

      autoTable(doc, {
        startY: y,
        head: [["Indicador", "Valor"]],
        body: [
          ["Lucro Total", `R$ ${fmt(data.totalProfit)}`],
          ["Gastos Total", `R$ ${fmt(data.totalExpense)}`],
          ["Saldo Líquido", `R$ ${fmt(data.balance)}`],
          ["Total Recebido (parcelas)", `R$ ${fmt(data.totalReceived)}`],
          ["Total em Atraso", `R$ ${fmt(data.totalOverdue)}`],
          ["Clientes Ativos", String(data.activeClients)],
        ],
        theme: "grid",
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 10 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      // Parcelas
      doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text("Parcelas do Período", 14, y); y += 2;
      autoTable(doc, {
        startY: y,
        head: [["Status", "Quantidade"]],
        body: [
          ["Pagas", String(data.paidCount)],
          ["Atrasadas", String(data.overdueCount)],
          ["Pendentes", String(data.pendingCount)],
        ],
        theme: "striped",
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 10 },
        bodyStyles: { fontSize: 9 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      // Lucros detalhados
      if (data.profitData.length > 0) {
        if (y > 240) { doc.addPage(); y = 20; }
        doc.setFontSize(13); doc.setFont("helvetica", "bold");
        doc.text(`Lucros (${data.profitData.length})`, 14, y); y += 2;
        autoTable(doc, {
          startY: y,
          head: [["Data", "Descrição", "Valor"]],
          body: data.profitData.map((p: any) => [
            formatBR(p.date),
            p.description,
            `R$ ${fmt(Number(p.amount))}`,
          ]),
          theme: "grid",
          headStyles: { fillColor: [22, 163, 74], textColor: 255, fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          columnStyles: { 2: { halign: "right" } },
          margin: { left: 14, right: 14 },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }

      // Gastos detalhados
      if (data.expenseData.length > 0) {
        if (y > 240) { doc.addPage(); y = 20; }
        doc.setFontSize(13); doc.setFont("helvetica", "bold");
        doc.text(`Gastos (${data.expenseData.length})`, 14, y); y += 2;
        autoTable(doc, {
          startY: y,
          head: [["Data", "Descrição", "Categoria", "Valor"]],
          body: data.expenseData.map((e: any) => [
            formatBR(e.date),
            e.description,
            e.category || "—",
            `R$ ${fmt(Number(e.amount))}`,
          ]),
          theme: "grid",
          headStyles: { fillColor: [220, 38, 38], textColor: 255, fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          columnStyles: { 3: { halign: "right" } },
          margin: { left: 14, right: 14 },
        });
      }

      // Footer em todas as páginas
      const pages = doc.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setFontSize(7); doc.setTextColor(140);
        doc.text(`${companyName} · Página ${p}/${pages}`, pageW / 2, 290, { align: "center" });
      }

      doc.save(`relatorio-${month}.pdf`);
      toast({ title: "✓ PDF gerado!" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="page-hero animate-fade-in relative overflow-hidden group">
        <div className="absolute inset-0 bg-linear-to-r from-primary/10 via-transparent to-transparent opacity-50 group-hover:opacity-100 transition-opacity" />
        <div className="page-hero-content flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 relative z-10">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20 sm:h-14 sm:w-14">
              <BarChart3 size={28} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-display text-2xl sm:text-3xl md:text-4xl font-bold text-foreground tracking-tight">Relatórios BI</h1>
              <p className="text-muted-foreground text-xs sm:text-sm font-medium opacity-70">Indicadores e desempenho financeiro</p>
            </div>
          </div>
          
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3">
            <div className="col-span-2 flex min-w-0 items-center gap-3 rounded-xl border border-border/40 bg-card/60 px-3 py-2.5 sm:col-span-1">
              <Calendar size={16} className="text-primary shrink-0" />
              <input id="report-month" name="report_month" type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                aria-label="Mês do relatório" className="min-w-0 flex-1 bg-transparent text-sm font-bold text-foreground focus:outline-hidden scheme-dark" />
            </div>
            <div className="h-10 w-px bg-border/20 hidden sm:block mx-1" />
            <div className="contents sm:flex sm:items-center sm:gap-2">
              <button type="button" onClick={handleExportCSV} disabled={!data || loading} className="flex items-center justify-center gap-2 rounded-xl border border-border/40 bg-muted/40 px-4 py-2.5 text-xs font-bold hover:bg-muted/60 disabled:opacity-50">
                <Download size={15} /> CSV
              </button>
              <button type="button" onClick={handleExportPDF} disabled={!data || loading} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                <FileDown size={15} /> PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="h-8 w-48 skeleton-shimmer rounded-lg" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{[1,2,3,4,5,6].map(i => <div key={i} className="h-24 rounded-xl skeleton-shimmer" />)}</div>
        </div>
      ) : reportError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 py-14 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-3 font-semibold text-foreground">Não foi possível gerar o relatório</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{reportError}</p>
          <button type="button" onClick={() => void fetchReport()} className="mt-4 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted">
            Tentar novamente
          </button>
        </div>
      ) : !data ? null : (
        <>
          {/* Month label */}
          <div className="flex items-center gap-2 animate-fade-in">
            <BarChart3 size={16} className="text-primary" />
            <h2 className="text-headline text-lg text-foreground capitalize">{monthLabel}</h2>
          </div>


          {/* Main stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-fade-in">
            {[
              { label: "Lucros", value: `R$ ${fmt(data.totalProfit)}`, icon: TrendingUp, color: "text-success", bg: "bg-success/8", glow: data.totalProfit > 0 ? "success-glow" : "" },
              { label: "Gastos", value: `R$ ${fmt(data.totalExpense)}`, icon: ArrowDownRight, color: "text-destructive", bg: "bg-destructive/8", glow: "" },
              { label: "Saldo", value: `R$ ${fmt(data.balance)}`, icon: Wallet, color: data.balance >= 0 ? "text-success" : "text-destructive", bg: data.balance >= 0 ? "bg-success/8" : "bg-destructive/8", glow: data.balance >= 0 ? "success-glow" : "danger-glow" },
              { label: "Recebido", value: `R$ ${fmt(data.totalReceived)}`, icon: CheckCircle, color: "text-success", bg: "bg-success/8", glow: "" },
              { label: "Em Atraso", value: `R$ ${fmt(data.totalOverdue)}`, icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/8", glow: data.totalOverdue > 0 ? "danger-glow" : "" },
              { label: "Clientes Ativos", value: String(data.activeClients), icon: Users, color: "text-primary", bg: "bg-primary/8", glow: "" },
            ].map((s) => (
              <div key={s.label} className={`min-w-0 rounded-2xl border border-border/60 bg-card/65 p-4 ${s.glow}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                    <s.icon size={16} className={s.color} />
                  </div>
                  <p className="text-label">{s.label}</p>
                </div>
                <p className={`wrap-break-word text-lg font-bold tabular-nums sm:text-xl ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Installments summary */}
          <div className="rounded-2xl border border-border bg-card p-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <Receipt size={16} className="text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Parcelas do Mês</h2>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: "Pagas", value: data.paidCount, icon: CheckCircle, color: "text-success", bg: "bg-success/10", border: "border-success/20" },
                { label: "Atrasadas", value: data.overdueCount, icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
                { label: "Pendentes", value: data.pendingCount, icon: Clock, color: "text-warning", bg: "bg-warning/10", border: "border-warning/20" },
              ].map(s => (
                <div key={s.label} className={`rounded-xl ${s.bg} border ${s.border} p-4 text-center`}>
                  <s.icon size={18} className={`${s.color} mx-auto mb-1`} />
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            {/* Progress bar */}
            {data.installmentData.length > 0 && (
              <div className="mt-4">
                <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                  <div className="h-full bg-success transition-all duration-500" style={{ width: `${boundedRatio(data.paidCount, data.installmentData.length)}%` }} />
                  <div className="h-full bg-destructive/60 transition-all duration-500" style={{ width: `${boundedRatio(data.overdueCount, data.installmentData.length)}%` }} />
                  <div className="h-full bg-warning/40 transition-all duration-500" style={{ width: `${boundedRatio(data.pendingCount, data.installmentData.length)}%` }} />
                </div>
                <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
                  <span>{data.paidCount} pagas</span>
                  <span>{data.installmentData.length} total</span>
                </div>
              </div>
            )}
          </div>

          {/* Profit details */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden animate-fade-in">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky-header">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center"><TrendingUp size={14} className="text-success" /></div>
                <h2 className="text-sm font-semibold text-foreground">Lucros ({data.profitData.length})</h2>
              </div>
              <span className="text-sm font-bold text-success">+R$ {fmt(data.totalProfit)}</span>
            </div>
            {data.profitData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum lucro neste período.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto divide-y divide-border/50">
                {data.profitData.map((p: any) => (
                  <div key={p.id} className="data-row">
                    <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                      <TrendingUp size={14} className="text-success" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{p.description}</p>
                      <p className="text-[10px] text-muted-foreground">{formatBR(p.date)}</p>
                    </div>
                    <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-success sm:text-sm">+R$ {fmt(Number(p.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expense details */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden animate-fade-in">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky-header">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center"><ArrowDownRight size={14} className="text-destructive" /></div>
                <h2 className="text-sm font-semibold text-foreground">Gastos ({data.expenseData.length})</h2>
              </div>
              <span className="text-sm font-bold text-destructive">−R$ {fmt(data.totalExpense)}</span>
            </div>
            {data.expenseData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum gasto neste período.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto divide-y divide-border/50">
                {data.expenseData.map((e: any) => (
                  <div key={e.id} className="data-row">
                    <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                      <ArrowDownRight size={14} className="text-destructive" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{e.description}</p>
                      <p className="text-[10px] text-muted-foreground">{e.category || "Sem categoria"} · {formatBR(e.date)}</p>
                    </div>
                    <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-destructive sm:text-sm">−R$ {fmt(Number(e.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Central de Exportação — CSVs por entidade com date range */}
      <ExportCenter />
    </div>
  );
};

export default Relatorios;
