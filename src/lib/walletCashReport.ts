import {z} from 'zod';
const money=z.number().finite().max(90071992547409.91).min(-90071992547409.91);
const positive=money.nonnegative();
export const walletCashReportSchema=z.object({
 as_of:z.string(),financial_day:z.string(),
 totals:z.object({inflows:positive,outflows:positive,capital:positive,withdrawals:positive,receipts:positive,disbursements:positive,
  ledger_expenses:positive,manual_expenses:positive,principal:positive,profit:positive,unclassified:positive,undated_amount:positive,legacy_gap_amount:positive,balance:money}),
 period:z.object({inflows:positive,outflows:positive,previous_inflows:positive,previous_outflows:positive,opening_balance:money,closing_balance:money}),
 forecast:z.object({d7:positive,d30:positive,d90:positive}),
 timeline:z.array(z.object({id:z.string(),type:z.enum(['in','out']),desc:z.string(),amount:positive,date:z.string().nullable(),source:z.string(),removable:z.boolean(),remove_id:z.string().nullable()})),
 timeline_count:z.number().int().nonnegative(),
 warnings:z.object({undated_amount:positive,legacy_gap_amount:positive,unlinked_receipts:z.number().int().nonnegative(),cash_above_installments:positive,future_amount:positive,recorded_profit:money}),
});
export type WalletCashReport=z.infer<typeof walletCashReportSchema>;
