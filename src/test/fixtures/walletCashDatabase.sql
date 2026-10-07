-- Synthetic wallet schema. Never load into the application database.
ALTER TABLE transactions ALTER principal_amount SET DEFAULT 0,ALTER interest_amount SET DEFAULT 0,ALTER fee_amount SET DEFAULT 0;
 ALTER TABLE profits ADD id uuid DEFAULT gen_random_uuid(),ADD date timestamptz DEFAULT now();
 CREATE TABLE expenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,description text,amount numeric,date timestamptz,category text);
