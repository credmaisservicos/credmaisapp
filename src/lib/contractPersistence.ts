type RpcResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;

export type AtomicContractInput = {
  clientId: string | null;
  client?: Record<string, unknown>;
  contract: Record<string, unknown>;
  installments: Array<{
    installment_number: number;
    amount: number;
    due_date: string;
    scheduled_principal?: number;
    scheduled_interest?: number;
  }>;
};

type AtomicContractResult = {
  client_id: string;
  contract_id: string;
  installment_count: number;
};

type RpcClient = {
  rpc: (
    name: "create_client_contract",
    args: Record<string, unknown>,
  ) => RpcResult<AtomicContractResult>;
};

/** Persiste cliente opcional, contrato e cronograma na mesma transação do banco. */
export async function createContractAtomically(
  client: RpcClient,
  input: AtomicContractInput,
): Promise<AtomicContractResult> {
  if (!input.installments.length) throw new Error("O contrato precisa ter ao menos uma parcela.");

  const { data, error } = await client.rpc("create_client_contract", {
    _client_id: input.clientId,
    _client: input.client ?? {},
    _contract: input.contract,
    _installments: input.installments,
  });

  if (error) throw error;
  if (!data?.contract_id || data.installment_count !== input.installments.length) {
    throw new Error("O banco não confirmou a criação completa do contrato.");
  }
  return data;
}

type PendingScheduleInput = {
  dueDates: string[];
  paidInstallmentNumbers: Iterable<number>;
  amount: number;
  /** Principal total to distribute across the complete schedule, when known. */
  capital?: number;
  userId: string;
  contractId: string;
  clientId: string;
};

/** Recria somente os números ainda não pagos, mesmo quando os pagamentos ocorreram fora de ordem. */
export function buildPendingSchedule(input: PendingScheduleInput) {
  const paid = new Set(input.paidInstallmentNumbers);
  return input.dueDates.flatMap((dueDate, index) => {
    const installmentNumber = index + 1;
    if (paid.has(installmentNumber)) return [];
    const principalBase = input.capital == null
      ? undefined
      : Math.round((input.capital / input.dueDates.length) * 100) / 100;
    const principal = principalBase == null
      ? undefined
      : installmentNumber === input.dueDates.length
        ? Math.round((input.capital! - principalBase * (input.dueDates.length - 1)) * 100) / 100
        : principalBase;
    return [{
      user_id: input.userId,
      contract_id: input.contractId,
      client_id: input.clientId,
      installment_number: installmentNumber,
      amount: input.amount,
      due_date: dueDate,
      status: "pending" as const,
      ...(principal == null ? {} : {
        scheduled_principal: principal,
        scheduled_interest: Math.round((input.amount - principal) * 100) / 100,
      }),
    }];
  });
}
