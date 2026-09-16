import type { ContractPlaceholderData } from "./contractTemplate";
import { toDateInputValue } from "@/lib/dateUtils";

/**
 * Cliente e empréstimo fictícios para a prévia do contrato.
 *
 * Antes, quem colava o próprio contrato em Configurações não tinha como saber se
 * tinha acertado as variáveis: só descobria ao fechar um empréstimo de verdade e
 * ver `{{nome_cliente}}` impresso no documento entregue ao cliente. A prévia
 * mostra o resultado preenchido enquanto a pessoa digita.
 *
 * Os dados abaixo são inventados de propósito — o CPF 000.000.000-00 é inválido
 * e nenhum nome corresponde a pessoa real.
 */
export function contratoDeExemplo(empresa: {
  nome?: string | null;
  cnpj?: string | null;
  endereco?: string | null;
  telefone?: string | null;
}): ContractPlaceholderData {
  const hoje = new Date();
  const venc = (n: number) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + n, hoje.getDate(), 12);
    return toDateInputValue(d);
  };

  return {
    clientName: "Maria Exemplo da Silva",
    cpfCnpj: "000.000.000-00",
    phone: "(11) 90000-0000",
    whatsapp: "(11) 90000-0000",
    email: "maria@exemplo.com",
    address: "Rua das Flores, 123 - Centro, São Paulo/SP - CEP: 01000-000",
    capital: 5000,
    interestRate: 10,
    totalAmount: 6000,
    totalInterest: 1000,
    installmentAmount: 1000,
    numInstallments: 6,
    frequency: "Mensal",
    startDate: venc(1),
    lateFeePercent: 0,
    dailyInterestPercent: 4,
    companyName: empresa.nome?.trim() || "Sua Empresa",
    companyCnpj: empresa.cnpj?.trim() || "00.000.000/0001-00",
    companyAddress: empresa.endereco?.trim() || "(preencha o endereço em Empresa)",
    companyPhone: empresa.telefone?.trim() || "(00) 0000-0000",
    paymentMethod: "pix",
    // Preenchidos para que a prévia mostre também as cláusulas condicionais —
    // é justamente nelas que o assinante precisa conferir o texto.
    guaranteeType: "aval",
    guaranteeDescription: "",
    guarantorName: "João Exemplo Avalista",
    guarantorCpf: "000.000.000-00",
    guarantorPhone: "(11) 90000-0000",
    gracePeriods: 0,
    graceDays: 0,
    earlyPaymentDiscountPercent: 5,
    maxInterestCapPercent: 100,
    installments: Array.from({ length: 6 }, (_, i) => ({
      installment_number: i + 1,
      amount: 1000,
      due_date: venc(i + 1),
    })),
  };
}
