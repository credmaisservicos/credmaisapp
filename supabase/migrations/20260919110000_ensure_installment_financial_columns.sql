-- The new payment RPC reads these fields from contract_installments%ROWTYPE.
-- Some databases created before the financial split migration do not have
-- them, which makes every payment fail with:
-- record "inst" has no field "scheduled_interest".
-- This is additive and preserves all existing installment rows.

ALTER TABLE public.contract_installments
  ADD COLUMN IF NOT EXISTS scheduled_principal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_interest numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_principal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_interest numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_fees numeric NOT NULL DEFAULT 0;

-- These columns are used by the same RPC and are also absent in some
-- pre-migration schemas. Keep the additions idempotent as well.
ALTER TABLE public.contract_installments
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

NOTIFY pgrst, 'reload schema';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS principal_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interest_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_key text;

NOTIFY pgrst, 'reload schema';
