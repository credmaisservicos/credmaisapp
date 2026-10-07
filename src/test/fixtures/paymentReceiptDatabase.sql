-- Synthetic receipt schema. Only load into isolated test databases.
ALTER TABLE transactions ADD id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ADD date timestamptz NOT NULL DEFAULT now();
 CREATE TABLE clients(id uuid PRIMARY KEY,user_id uuid,name text,phone text,whatsapp text);
 ALTER TABLE settings ADD company_name text,ADD bot_send_receipt boolean DEFAULT true,ADD bot_enabled boolean DEFAULT true,
   ADD bot_auto_send boolean DEFAULT true,ADD whatsapp_instance text DEFAULT 'main';
 CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,client_id uuid,phone text,jid text,instance text,
   contact_name text,updated_at timestamptz DEFAULT now(),blocked boolean DEFAULT false,bot_paused boolean DEFAULT false,needs_human boolean DEFAULT false,
   bot_status text DEFAULT 'active',UNIQUE(user_id,phone));
 ALTER TABLE whatsapp_scheduled_messages ADD conversation_id uuid,ADD installment_id uuid,ADD source_key text,ADD text text,
   ADD scheduled_for timestamptz,ADD expected_amount numeric,ADD approved_by uuid;
 CREATE UNIQUE INDEX receipt_source_key ON whatsapp_scheduled_messages(user_id,source_key);
