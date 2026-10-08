import {emptyWalletCashReport} from './walletCash';
import type {FinancialAnalytics} from '../../src/lib/financialAnalytics';
export const emptyFinancialAnalyticsReport=():FinancialAnalytics=>({wallet:emptyWalletCashReport(),receipts:[],disbursements:[],expenses:[],capital:[],warnings:{contracts_without_disbursement:0,unlinked_principal:0}});
