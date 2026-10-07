import type {WalletCashReport} from '../../src/lib/walletCashReport';
export const emptyWalletCashReport=():WalletCashReport=>({
 as_of:'2026-10-08T15:00:00Z',financial_day:'2026-10-08',
 totals:{inflows:0,outflows:0,capital:0,withdrawals:0,receipts:0,disbursements:0,ledger_expenses:0,manual_expenses:0,principal:0,profit:0,unclassified:0,undated_amount:0,legacy_gap_amount:0,balance:0},
 period:{inflows:0,outflows:0,previous_inflows:0,previous_outflows:0,opening_balance:0,closing_balance:0},forecast:{d7:0,d30:0,d90:0},timeline:[],timeline_count:0,
 warnings:{undated_amount:0,legacy_gap_amount:0,unlinked_receipts:0,cash_above_installments:0,future_amount:0,recorded_profit:0},
});
