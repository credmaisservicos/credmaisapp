import { loadPdfLib } from "@/utils/pdfLib";
import { formatBR, todayLocalISO } from "@/lib/dateUtils";
import { portalInstallmentAmount } from "@/lib/portalAmounts";
import { formatFrequency } from "@/components/cliente-detalhe/constants";

export const generatePortalReceiptPdf = async (client: any, installment: any, company: any) => {
  const { jsPDF, autoTable } = await loadPdfLib();
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 40, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text("RECIBO DE PAGAMENTO", pageWidth / 2, 25, { align: "center" });

  // Company Info
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(company?.name || "CredMais App", 20, 50);
  doc.setFont("helvetica", "normal");
  doc.text(`Chave PIX: ${company?.pix_key || "Não informada"}`, 20, 55);

  // Client Info
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("DADOS DO CLIENTE", 20, 75);
  doc.setLineWidth(0.5);
  doc.line(20, 77, 80, 77);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Nome: ${client.name}`, 20, 85);
  doc.text(`CPF/CNPJ: ${client.cpf_cnpj}`, 20, 90);

  // Payment Info
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("DETALHES DO PAGAMENTO", 20, 110);
  doc.line(20, 112, 80, 112);

  const amountValue = Number(installment.paid_amount ?? installment.amount ?? 0);
  const amount = Number.isFinite(amountValue) ? amountValue : 0;
  const data = [
    ["Descrição", "Parcela #" + installment.installment_number],
    ["Vencimento Original", formatBR(installment.due_date)],
    ["Data do Pagamento", installment.paid_at ? formatBR(installment.paid_at) : "Confirmado via Portal"],
    ["Valor Pago", `R$ ${amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`],
    ["Status", "LIQUIDADO / PAGO"]
  ];

  autoTable(doc, {
    startY: 120,
    head: [["Campo", "Valor"]],
    body: data,
    theme: "striped",
    headStyles: { fillColor: [15, 23, 42] },
    margin: { left: 20, right: 20 }
  });

  // Footer
  const finalY = (doc as any).lastAutoTable.finalY + 30;
  doc.setFontSize(10);
  doc.text("__________________________________________", pageWidth / 2, finalY, { align: "center" });
  doc.text(company?.name || "Assinatura do Credor", pageWidth / 2, finalY + 7, { align: "center" });

  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")} pelo Portal do Cliente`, pageWidth / 2, 285, { align: "center" });

  const clientFileName = String(client?.name || "cliente").replace(/\s+/g, "_");
  doc.save(`Recibo_Parcela_${installment.installment_number}_${clientFileName}.pdf`);
};

export const generatePortalStatementPdf = async (client: any, contracts: any[], company: any) => {
  const { jsPDF, autoTable } = await loadPdfLib();
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const fmt = (v: number) => { const number = Number(v); return `R$ ${(Number.isFinite(number) ? number : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`; };

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("EXTRATO COMPLETO", pageWidth / 2, 22, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Emitido em ${new Date().toLocaleString("pt-BR")}`, pageWidth / 2, 30, { align: "center" });

  // Client + company
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("CLIENTE", 20, 52);
  doc.setFont("helvetica", "normal");
  doc.text(`${client.name}  ·  CPF/CNPJ: ${client.cpf_cnpj || "—"}`, 20, 58);

  doc.setFont("helvetica", "bold");
  doc.text("CREDOR", pageWidth - 20, 52, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(`${company?.name || "CredMais App"}`, pageWidth - 20, 58, { align: "right" });
  if (company?.pix_key) doc.text(`PIX: ${company.pix_key}`, pageWidth - 20, 63, { align: "right" });

  // Totais consolidados
  let totalCap = 0, totalDivida = 0, totalPago = 0, totalOverdue = 0;
  contracts.forEach((c: any) => {
    totalCap += Number.isFinite(Number(c.capital)) ? Number(c.capital) : 0;
    totalDivida += Number.isFinite(Number(c.total_amount)) ? Number(c.total_amount) : 0;
    (c.installments || []).forEach((i: any) => {
      if (i.status === "paid") totalPago += Number.isFinite(Number(i.paid_amount ?? i.amount)) ? Number(i.paid_amount ?? i.amount) : 0;
      if (i.status === "overdue") {
        totalOverdue += portalInstallmentAmount({
          ...i,
          daily_interest_percent: c.daily_interest_percent,
          max_interest_cap_percent: c.max_interest_cap_percent,
        });
      }
    });
  });

  autoTable(doc, {
    startY: 72,
    head: [["Capital emprestado", "Total do débito", "Já pago", "Em atraso"]],
    body: [[fmt(totalCap), fmt(totalDivida), fmt(totalPago), fmt(totalOverdue)]],
    theme: "grid",
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 10, fontStyle: "bold" },
    margin: { left: 20, right: 20 },
  });

  let cursorY = (doc as any).lastAutoTable.finalY + 10;

  contracts.forEach((c: any, idx: number) => {
    if (cursorY > 240) { doc.addPage(); cursorY = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`Contrato ${idx + 1}  ·  ${fmt(Number(c.capital))}  ·  ${c.num_installments}x  ·  ${formatFrequency(c.frequency)}`, 20, cursorY);
    cursorY += 3;

    const rows = (c.installments || []).map((i: any) => [
      `#${i.installment_number}`,
      formatBR(i.due_date),
      fmt(Number(i.amount || 0)),
      i.status === "paid" ? "PAGO" : i.status === "overdue" ? "ATRASO" : "PENDENTE",
      i.paid_at ? formatBR(i.paid_at) : "—",
      i.status === "paid" ? fmt(Number(i.paid_amount || i.amount)) : "—",
    ]);

    autoTable(doc, {
      startY: cursorY + 2,
      head: [["#", "Venc.", "Valor", "Status", "Pago em", "Valor pago"]],
      body: rows,
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 20, right: 20 },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 8;
  });

  // Footer
  const pages = (doc as any).internal.pages.length - 1;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Página ${p}/${pages}  ·  Gerado pelo Portal do Cliente`, pageWidth / 2, 290, { align: "center" });
  }

  const clientFileName = String(client?.name || "cliente").replace(/\s+/g, "_");
  doc.save(`Extrato_${clientFileName}_${todayLocalISO()}.pdf`);
};
