-- Synthetic database fixture. Never load into the application's database.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.owner',true),'')::uuid$$;
CREATE TABLE contracts(id uuid PRIMARY KEY,user_id uuid,client_id uuid,status text,lifecycle_stage text DEFAULT 'active',activated_at timestamptz,
  capital numeric DEFAULT 90,total_interest numeric DEFAULT 10,total_amount numeric DEFAULT 100,loan_mode text DEFAULT 'fixed',interest_rate numeric DEFAULT 10,
  grace_periods int DEFAULT 0,num_installments int DEFAULT 1,installment_amount numeric DEFAULT 100,
  daily_interest_percent numeric DEFAULT 4,daily_penalty_type text DEFAULT 'percentage',daily_penalty_value numeric DEFAULT 0,max_interest_cap_percent numeric DEFAULT 0);
CREATE TABLE contract_installments(id uuid PRIMARY KEY,user_id uuid,client_id uuid,contract_id uuid,installment_number int,
  amount numeric,due_date timestamptz,status text,paid_amount numeric DEFAULT 0,late_fee numeric DEFAULT 0,
  scheduled_interest numeric DEFAULT 10,scheduled_principal numeric DEFAULT 90,paid_principal numeric DEFAULT 0,paid_interest numeric DEFAULT 0,paid_fees numeric DEFAULT 0,
  paid_at timestamptz,payment_method text,receipt_url text,pre_settlement_snapshot jsonb);
CREATE TABLE transactions(user_id uuid,amount numeric,type text,category text,description text,client_id uuid,contract_id uuid,installment_id uuid,
  principal_amount numeric,interest_amount numeric,fee_amount numeric,source_key text);
CREATE TABLE profits(user_id uuid,amount numeric,description text,client_id uuid,installment_id uuid);
CREATE UNIQUE INDEX uq_profit_installment ON profits(installment_id) WHERE installment_id IS NOT NULL;
CREATE TABLE collectors(id uuid PRIMARY KEY,user_id uuid,is_active boolean,name text);
CREATE TABLE collector_tokens(id uuid,token text,collector_id uuid,user_id uuid,is_active boolean);
CREATE TABLE collector_assignments(collector_id uuid,user_id uuid,client_id uuid);
CREATE TABLE collection_attempts(user_id uuid,client_id uuid,contract_id uuid,installment_id uuid,channel text,message_preview text);
CREATE TABLE settings(user_id uuid,bot_auto_confirm_payment boolean,default_daily_interest numeric);
CREATE TABLE whatsapp_receipt_reviews(id uuid PRIMARY KEY,user_id uuid,client_id uuid,installment_id uuid,amount numeric,status text DEFAULT 'pending',
  metadata jsonb DEFAULT '{}',reviewed_at timestamptz,reviewed_by uuid);
CREATE TABLE whatsapp_scheduled_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,client_id uuid,purpose text,status text,error text,delivery_started_at timestamptz);
CREATE TABLE client_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL,user_id uuid NOT NULL,contract_id uuid,installment_id uuid,
  type text NOT NULL,title text NOT NULL,message text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',
  dedupe_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,created_at timestamptz DEFAULT now(),
  UNIQUE(installment_id,type,dedupe_day));
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,message text NOT NULL,type text,"from" text,link text,created_at timestamptz DEFAULT now());
