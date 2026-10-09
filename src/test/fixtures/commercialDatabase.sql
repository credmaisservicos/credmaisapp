-- Synthetic commercial prerequisites. Only load into isolated test databases.
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,
 action text,entity_type text,entity_id uuid,details jsonb);
