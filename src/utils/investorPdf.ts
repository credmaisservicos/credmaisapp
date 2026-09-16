import { loadPdfLib } from "@/utils/pdfLib";
import { formatBR, formatBRDateTime, parseLocalDate } from "@/lib/dateUtils";

const safeNumber = (value: unknown) => Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0;
const brl = (n: number) => safeNumber(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (s?: string | null) => formatBR(s) || "-";

export async function generateInvestorStatementPdf(payload: {
  investor: { name: string; cpf_cnpj: string | null; email: string | null };
  loans: Array<any>;
  owner: { name?: string; pix_key?: string };
  branding: { company_name?: string; portal_title?: string };
}) {
  const { jsPDF, autoTable } = await loadPdfLib();
  const doc = new jsPDF();
  const w = doc.internal.pageSize.getWidth();
  const company = payload.branding?.company_name || payload.branding?.portal_title || "CredMais";

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, w, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("EXTRATO DO INVESTIDOR", w / 2, 14, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`${company} • Emitido em ${new Date().toLocaleDateString("pt-BR")}`, w / 2, 22, { align: "center" });

  // Investor
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("INVESTIDOR", 14, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Nome: ${payload.investor.name}`, 14, 51);
  if (payload.investor.cpf_cnpj) doc.text(`CPF/CNPJ: ${payload.investor.cpf_cnpj}`, 14, 57);
  if (payload.investor.email) doc.text(`E-mail: ${payload.investor.email}`, 14, 63);

  // KPIs
  const active = payload.loans.filter((l) => l.status !== "paid");
  const capital = active.reduce((s, l) => s + safeNumber(l.principal), 0);
  const receber = active.reduce((s, l) => s + (safeNumber(l.total_due) - safeNumber(l.paid_amount)), 0);
  const recebido = payload.loans.reduce((s, l) => s + safeNumber(l.paid_amount), 0);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("RESUMO", 14, 78);
  autoTable(doc, {
    startY: 82,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [79, 70, 229], textColor: 255 },
    head: [["Capital investido", "A receber", "Já recebido", "Contratos ativos"]],
    body: [[brl(capital), brl(receber), brl(recebido), String(active.length)]],
  });

  // Loans table
  let y = (doc as any).lastAutoTable.finalY + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("CONTRATOS", 14, y);
  autoTable(doc, {
    startY: y + 4,
    theme: "striped",
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    head: [["Início", "Vence", "Capital", "Juros %", "Total devido", "Pago", "Saldo", "Status"]],
    body: payload.loans.map((l) => [
      dt(l.start_date),
      dt(l.due_date),
      brl(l.principal),
      `${l.interest_rate}%`,
      brl(l.total_due),
      brl(l.paid_amount),
      brl(safeNumber(l.total_due) - safeNumber(l.paid_amount)),
      l.status === "paid" ? "Quitado" : "Ativo",
    ]),
  });

  // Payments
  const allPayments = payload.loans.flatMap((l: any) =>
    (l.payments || []).map((p: any) => ({ ...p, loan_due: l.due_date }))
  );
  if (allPayments.length) {
    y = (doc as any).lastAutoTable.finalY + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("HISTÓRICO DE PAGAMENTOS", 14, y);
    autoTable(doc, {
      startY: y + 4,
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [16, 185, 129], textColor: 255 },
      head: [["Data", "Método", "Valor"]],
      body: allPayments
        .sort((a: any, b: any) => (parseLocalDate(b.paid_at)?.getTime() ?? 0) - (parseLocalDate(a.paid_at)?.getTime() ?? 0))
        .map((p: any) => [dt(p.paid_at), p.method || "—", brl(p.amount)]),
    });
  }

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `Documento gerado em ${formatBRDateTime(new Date())} • ${company} • Credor: ${payload.owner?.name || "-"}`,
    w / 2, pageH - 8, { align: "center" }
  );

  const investorFileName = String(payload.investor?.name || "investidor").replace(/\s+/g, "-").toLowerCase();
  doc.save(`extrato-investidor-${investorFileName}.pdf`);
}
