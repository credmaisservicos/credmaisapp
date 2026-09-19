export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      automation_logs: {
        Row: {
          automation_id: string | null
          created_at: string
          id: string
          level: string
          message: string
          metadata: Json | null
        }
        Insert: {
          automation_id?: string | null
          created_at?: string
          id?: string
          level: string
          message: string
          metadata?: Json | null
        }
        Update: {
          automation_id?: string | null
          created_at?: string
          id?: string
          level?: string
          message?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "system_automations"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_actions_log: {
        Row: {
          client_id: string | null
          conversation_id: string | null
          created_at: string
          error_message: string | null
          id: string
          success: boolean
          tool_input: Json
          tool_name: string
          tool_output: Json
          user_id: string
        }
        Insert: {
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          success?: boolean
          tool_input?: Json
          tool_name: string
          tool_output?: Json
          user_id: string
        }
        Update: {
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          success?: boolean
          tool_input?: Json
          tool_name?: string
          tool_output?: Json
          user_id?: string
        }
        Relationships: []
      }
      chat_channel_members: {
        Row: {
          channel_id: string
          id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_announcement: boolean
          is_default: boolean
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_announcement?: boolean
          is_default?: boolean
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_announcement?: boolean
          is_default?: boolean
          name?: string
        }
        Relationships: []
      }
      chat_dm_threads: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          last_read_a: string
          last_read_b: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          last_read_a?: string
          last_read_b?: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          last_read_a?: string
          last_read_b?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      chat_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          channel_id: string | null
          content: string
          created_at: string
          deleted_by: string | null
          dm_thread_id: string | null
          edited_at: string | null
          file_name: string | null
          file_type: string | null
          file_url: string | null
          id: string
          is_deleted: boolean
          is_pinned: boolean
          reply_to: Json | null
          type: string
          user_avatar: string | null
          user_id: string
          user_name: string
        }
        Insert: {
          channel_id?: string | null
          content: string
          created_at?: string
          deleted_by?: string | null
          dm_thread_id?: string | null
          edited_at?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_deleted?: boolean
          is_pinned?: boolean
          reply_to?: Json | null
          type?: string
          user_avatar?: string | null
          user_id: string
          user_name: string
        }
        Update: {
          channel_id?: string | null
          content?: string
          created_at?: string
          deleted_by?: string | null
          dm_thread_id?: string | null
          edited_at?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_deleted?: boolean
          is_pinned?: boolean
          reply_to?: Json | null
          type?: string
          user_avatar?: string | null
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_dm_thread_id_fkey"
            columns: ["dm_thread_id"]
            isOneToOne: false
            referencedRelation: "chat_dm_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      client_errors: {
        Row: {
          contexto: Json
          criado_em: string
          id: string
          mensagem: string
          navegador: string | null
          pilha: string | null
          rota: string
          user_id: string | null
        }
        Insert: {
          contexto?: Json
          criado_em?: string
          id?: string
          mensagem: string
          navegador?: string | null
          pilha?: string | null
          rota?: string
          user_id?: string | null
        }
        Update: {
          contexto?: Json
          criado_em?: string
          id?: string
          mensagem?: string
          navegador?: string | null
          pilha?: string | null
          rota?: string
          user_id?: string | null
        }
        Relationships: []
      }
      client_notifications: {
        Row: {
          client_id: string
          contract_id: string | null
          created_at: string
          dedupe_day: string
          id: string
          installment_id: string | null
          is_read: boolean
          message: string
          metadata: Json
          title: string
          type: string
          user_id: string
        }
        Insert: {
          client_id: string
          contract_id?: string | null
          created_at?: string
          dedupe_day?: string
          id?: string
          installment_id?: string | null
          is_read?: boolean
          message: string
          metadata?: Json
          title: string
          type: string
          user_id: string
        }
        Update: {
          client_id?: string
          contract_id?: string | null
          created_at?: string
          dedupe_day?: string
          id?: string
          installment_id?: string | null
          is_read?: boolean
          message?: string
          metadata?: Json
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notifications_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notifications_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "contract_installments"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tokens: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_active: boolean | null
          token: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          token: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: Json | null
          avatar_url: string | null
          birth_date: string | null
          bot_memory: string | null
          cellphone_sale: Json | null
          client_type: string
          cpf_cnpj: string | null
          created_at: string
          credit_score: number | null
          documents: Json | null
          email: string | null
          id: string
          loan: Json | null
          name: string
          phone: string | null
          status: string
          user_id: string
          whatsapp: string | null
        }
        Insert: {
          address?: Json | null
          avatar_url?: string | null
          birth_date?: string | null
          bot_memory?: string | null
          cellphone_sale?: Json | null
          client_type?: string
          cpf_cnpj?: string | null
          created_at?: string
          credit_score?: number | null
          documents?: Json | null
          email?: string | null
          id?: string
          loan?: Json | null
          name: string
          phone?: string | null
          status?: string
          user_id: string
          whatsapp?: string | null
        }
        Update: {
          address?: Json | null
          avatar_url?: string | null
          birth_date?: string | null
          bot_memory?: string | null
          cellphone_sale?: Json | null
          client_type?: string
          cpf_cnpj?: string | null
          created_at?: string
          credit_score?: number | null
          documents?: Json | null
          email?: string | null
          id?: string
          loan?: Json | null
          name?: string
          phone?: string | null
          status?: string
          user_id?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      collection_attempts: {
        Row: {
          channel: string
          client_id: string | null
          contract_id: string | null
          created_at: string
          id: string
          installment_id: string | null
          message_preview: string | null
          user_id: string
        }
        Insert: {
          channel: string
          client_id?: string | null
          contract_id?: string | null
          created_at?: string
          id?: string
          installment_id?: string | null
          message_preview?: string | null
          user_id: string
        }
        Update: {
          channel?: string
          client_id?: string | null
          contract_id?: string | null
          created_at?: string
          id?: string
          installment_id?: string | null
          message_preview?: string | null
          user_id?: string
        }
        Relationships: []
      }
      collector_assignments: {
        Row: {
          client_id: string
          collector_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          client_id: string
          collector_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          client_id?: string
          collector_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collector_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collector_assignments_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["id"]
          },
        ]
      }
      collector_tokens: {
        Row: {
          collector_id: string
          created_at: string
          id: string
          is_active: boolean | null
          token: string
          user_id: string
        }
        Insert: {
          collector_id: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          token: string
          user_id: string
        }
        Update: {
          collector_id?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collector_tokens_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["id"]
          },
        ]
      }
      collectors: {
        Row: {
          city: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          phone: string
          state: string
          user_id: string
        }
        Insert: {
          city: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          phone: string
          state: string
          user_id: string
        }
        Update: {
          city?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          phone?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      contract_installments: {
        Row: {
          amount: number
          client_id: string
          collection_count: number
          collection_status: string | null
          contract_id: string
          created_at: string
          due_date: string
          id: string
          installment_number: number
          last_collected_at: string | null
          last_collected_channel: string | null
          late_fee: number | null
          paid_amount: number | null
          paid_fees: number
          paid_interest: number
          paid_principal: number
          paid_at: string | null
          payment_method: string | null
          receipt_review_status: string
          receipt_storage_path: string | null
          receipt_url: string | null
          scheduled_interest: number
          scheduled_principal: number
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          client_id: string
          collection_count?: number
          collection_status?: string | null
          contract_id: string
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          last_collected_at?: string | null
          last_collected_channel?: string | null
          late_fee?: number | null
          paid_amount?: number | null
          paid_fees?: number
          paid_interest?: number
          paid_principal?: number
          paid_at?: string | null
          payment_method?: string | null
          receipt_review_status?: string
          receipt_storage_path?: string | null
          receipt_url?: string | null
          scheduled_interest?: number
          scheduled_principal?: number
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          client_id?: string
          collection_count?: number
          collection_status?: string | null
          contract_id?: string
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          last_collected_at?: string | null
          last_collected_channel?: string | null
          late_fee?: number | null
          paid_amount?: number | null
          paid_fees?: number
          paid_interest?: number
          paid_principal?: number
          paid_at?: string | null
          payment_method?: string | null
          receipt_review_status?: string
          receipt_storage_path?: string | null
          receipt_url?: string | null
          scheduled_interest?: number
          scheduled_principal?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_installments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_installments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          attachments: Json
          auto_renew: boolean
          capital: number
          client_id: string
          created_at: string
          daily_interest_percent: number
          early_payment_discount_percent: number
          frequency: string
          grace_days: number
          grace_periods: number
          guarantee_description: string | null
          guarantee_type: string | null
          guarantor_cpf: string | null
          guarantor_name: string | null
          guarantor_phone: string | null
          id: string
          installment_amount: number
          interest_rate: number
          investor_loan_id: string | null
          late_fee_percent: number
          loan_mode: string
          max_interest_cap_percent: number | null
          notes: string | null
          num_installments: number
          payment_method: string
          signature_status: string
          signature_token: string | null
          signature_url: string | null
          signed_at: string | null
          start_date: string
          status: string
          total_amount: number
          total_interest: number
          user_id: string
        }
        Insert: {
          attachments?: Json
          auto_renew?: boolean
          capital: number
          client_id: string
          created_at?: string
          daily_interest_percent?: number
          early_payment_discount_percent?: number
          frequency?: string
          grace_days?: number
          grace_periods?: number
          guarantee_description?: string | null
          guarantee_type?: string | null
          guarantor_cpf?: string | null
          guarantor_name?: string | null
          guarantor_phone?: string | null
          id?: string
          installment_amount: number
          interest_rate?: number
          investor_loan_id?: string | null
          late_fee_percent?: number
          loan_mode?: string
          max_interest_cap_percent?: number | null
          notes?: string | null
          num_installments: number
          payment_method?: string
          signature_status?: string
          signature_token?: string | null
          signature_url?: string | null
          signed_at?: string | null
          start_date?: string
          status?: string
          total_amount?: number
          total_interest?: number
          user_id: string
        }
        Update: {
          attachments?: Json
          auto_renew?: boolean
          capital?: number
          client_id?: string
          created_at?: string
          daily_interest_percent?: number
          early_payment_discount_percent?: number
          frequency?: string
          grace_days?: number
          grace_periods?: number
          guarantee_description?: string | null
          guarantee_type?: string | null
          guarantor_cpf?: string | null
          guarantor_name?: string | null
          guarantor_phone?: string | null
          id?: string
          installment_amount?: number
          interest_rate?: number
          investor_loan_id?: string | null
          late_fee_percent?: number
          loan_mode?: string
          max_interest_cap_percent?: number | null
          notes?: string | null
          num_installments?: number
          payment_method?: string
          signature_status?: string
          signature_token?: string | null
          signature_url?: string | null
          signed_at?: string | null
          start_date?: string
          status?: string
          total_amount?: number
          total_interest?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_investor_loan_id_fkey"
            columns: ["investor_loan_id"]
            isOneToOne: false
            referencedRelation: "investor_loans"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          date: string
          description: string
          fee_amount: number
          id: string
          receipt_url: string | null
          user_id: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          date: string
          description: string
          id?: string
          receipt_url?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          receipt_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          created_at: string
          current_amount: number
          description: string
          frequency: string
          id: string
          target_amount: number
          user_id: string
        }
        Insert: {
          created_at?: string
          current_amount?: number
          description: string
          frequency: string
          id?: string
          target_amount: number
          user_id: string
        }
        Update: {
          created_at?: string
          current_amount?: number
          description?: string
          frequency?: string
          id?: string
          target_amount?: number
          user_id?: string
        }
        Relationships: []
      }
      installments_legado_20260805: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          due_date: string
          id: string
          installment_number: number
          paid_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          paid_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          paid_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      investor_loans: {
        Row: {
          created_at: string
          due_date: string
          frequency: string
          id: string
          interest_rate: number
          investor_id: string
          notes: string | null
          paid_amount: number
          paid_at: string | null
          payment_method: string | null
          principal: number
          start_date: string
          status: string
          total_due: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          due_date: string
          frequency?: string
          id?: string
          interest_rate?: number
          investor_id: string
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_method?: string | null
          principal: number
          start_date?: string
          status?: string
          total_due: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          due_date?: string
          frequency?: string
          id?: string
          interest_rate?: number
          investor_id?: string
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_method?: string | null
          principal?: number
          start_date?: string
          status?: string
          total_due?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_loans_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
        ]
      }
      investor_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          investor_id: string
          loan_id: string
          method: string | null
          notes: string | null
          paid_at: string
          receipt_url: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          investor_id: string
          loan_id: string
          method?: string | null
          notes?: string | null
          paid_at?: string
          receipt_url?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          investor_id?: string
          loan_id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string
          receipt_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_payments_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investor_payments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "investor_loans"
            referencedColumns: ["id"]
          },
        ]
      }
      investors: {
        Row: {
          access_token: string
          avatar_url: string | null
          cpf_cnpj: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          pix_key: string | null
          pix_key_type: string | null
          status: string
          updated_at: string
          user_id: string
          whatsapp: string | null
        }
        Insert: {
          access_token?: string
          avatar_url?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          status?: string
          updated_at?: string
          user_id: string
          whatsapp?: string | null
        }
        Update: {
          access_token?: string
          avatar_url?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          ai_summary: string | null
          amount_requested: number | null
          converted_client_id: string | null
          cpf: string | null
          created_at: string
          email: string | null
          id: string
          income_monthly: number | null
          last_message_at: string | null
          name: string | null
          next_followup_at: string | null
          notes: Json
          phone: string
          purpose: string | null
          score: number
          source: string
          stage: string
          tags: string[]
          term_months: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          amount_requested?: number | null
          converted_client_id?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          id?: string
          income_monthly?: number | null
          last_message_at?: string | null
          name?: string | null
          next_followup_at?: string | null
          notes?: Json
          phone: string
          purpose?: string | null
          score?: number
          source?: string
          stage?: string
          tags?: string[]
          term_months?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          amount_requested?: number | null
          converted_client_id?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          id?: string
          income_monthly?: number | null
          last_message_at?: string | null
          name?: string | null
          next_followup_at?: string | null
          notes?: Json
          phone?: string
          purpose?: string | null
          score?: number
          source?: string
          stage?: string
          tags?: string[]
          term_months?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          is_active: boolean | null
          name: string
          trigger_days: number | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          name: string
          trigger_days?: number | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          name?: string
          trigger_days?: number | null
          user_id?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          created_at: string
          id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          from: string
          id: string
          is_read: boolean
          link: string | null
          message: string
          sent_at: string
          subscription_cycle: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          from?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          sent_at?: string
          subscription_cycle?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          from?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          sent_at?: string
          subscription_cycle?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          allow_new_registrations: boolean
          checkout_url: string | null
          default_trial_days: number
          global_announcement: string | null
          id: boolean
          maintenance_message: string | null
          maintenance_mode: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_new_registrations?: boolean
          checkout_url?: string | null
          default_trial_days?: number
          global_announcement?: string | null
          id?: boolean
          maintenance_message?: string | null
          maintenance_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_new_registrations?: boolean
          checkout_url?: string | null
          default_trial_days?: number
          global_announcement?: string | null
          id?: boolean
          maintenance_message?: string | null
          maintenance_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      pledges: {
        Row: {
          client_name: string
          created_at: string
          description: string
          estimated_value: number
          id: string
          notes: string | null
          photo_url: string | null
          pledge_date: string
          return_date: string | null
          status: string
          user_id: string
        }
        Insert: {
          client_name: string
          created_at?: string
          description: string
          estimated_value?: number
          id?: string
          notes?: string | null
          photo_url?: string | null
          pledge_date?: string
          return_date?: string | null
          status?: string
          user_id: string
        }
        Update: {
          client_name?: string
          created_at?: string
          description?: string
          estimated_value?: number
          id?: string
          notes?: string | null
          photo_url?: string | null
          pledge_date?: string
          return_date?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      portal_sessions: {
        Row: {
          client_id: string
          created_at: string
          expires_at: string
          token: string
        }
        Insert: {
          client_id: string
          created_at?: string
          expires_at?: string
          token?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          expires_at?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          billing_message: string | null
          created_at: string
          email: string | null
          expense_balance: number
          id: string
          is_admin: boolean
          is_blocked: boolean
          is_chat_blocked: boolean
          loan_balance: number
          name: string
          onboarding_completed_at: string | null
          pix_key: string | null
          pix_key_type: string | null
          plan_tier: string
          profit_balance: number
          subscription_expires_at: string | null
          subscription_type: string | null
          trial_ends_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          billing_message?: string | null
          created_at?: string
          email?: string | null
          expense_balance?: number
          id: string
          is_admin?: boolean
          is_blocked?: boolean
          is_chat_blocked?: boolean
          loan_balance?: number
          name?: string
          onboarding_completed_at?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          plan_tier?: string
          profit_balance?: number
          subscription_expires_at?: string | null
          subscription_type?: string | null
          trial_ends_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          billing_message?: string | null
          created_at?: string
          email?: string | null
          expense_balance?: number
          id?: string
          is_admin?: boolean
          is_blocked?: boolean
          is_chat_blocked?: boolean
          loan_balance?: number
          name?: string
          onboarding_completed_at?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          plan_tier?: string
          profit_balance?: number
          subscription_expires_at?: string | null
          subscription_type?: string | null
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      profits: {
        Row: {
          amount: number
          client_id: string | null
          created_at: string
          date: string
          description: string
          id: string
          installment_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          client_id?: string | null
          created_at?: string
          date?: string
          description: string
          id?: string
          installment_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          client_id?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          installment_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profits_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "contract_installments"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_hits: {
        Row: {
          key: string
          tokens: number
          updated_at: string
        }
        Insert: {
          key: string
          tokens: number
          updated_at?: string
        }
        Update: {
          key?: string
          tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      rentals: {
        Row: {
          client_id: string
          client_name: string
          created_at: string
          end_date: string
          id: string
          is_paid: boolean
          price: number
          rental_type: string
          start_date: string
          user_id: string
          vehicle_id: string
        }
        Insert: {
          client_id: string
          client_name: string
          created_at?: string
          end_date: string
          id?: string
          is_paid?: boolean
          price: number
          rental_type: string
          start_date: string
          user_id: string
          vehicle_id: string
        }
        Update: {
          client_id?: string
          client_name?: string
          created_at?: string
          end_date?: string
          id?: string
          is_paid?: boolean
          price?: number
          rental_type?: string
          start_date?: string
          user_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rentals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          accent_color: string | null
          border_radius: string | null
          bot_auto_confirm_payment: boolean | null
          bot_auto_send: boolean | null
          bot_business_end: string | null
          bot_business_hours_only: boolean | null
          bot_business_start: string | null
          bot_closing_message: string | null
          bot_enabled: boolean | null
          bot_escalation_rules: Json | null
          bot_greeting_message: string | null
          bot_max_messages_per_day: number | null
          bot_negotiation_enabled: boolean | null
          bot_notify_owner: boolean | null
          bot_process_audio: boolean | null
          bot_process_receipts: boolean | null
          bot_retry_interval_hours: number | null
          bot_send_audio: boolean | null
          bot_send_hour: number | null
          bot_send_minute: number | null
          bot_send_pix: boolean | null
          bot_send_receipt: boolean | null
          bot_stop_on_payment: boolean | null
          bot_tone: string | null
          bot_use_ai: boolean | null
          bot_work_days: Json | null
          company_address: string | null
          company_cnpj: string | null
          company_logo_url: string | null
          company_name: string | null
          company_phone: string | null
          created_at: string
          custom_contract_template: string | null
          default_daily_interest: number | null
          default_frequency: string | null
          default_interest_rate: number | null
          default_late_fee: number | null
          default_max_interest_cap: number | null
          default_num_installments: number | null
          default_payment_method: string | null
          default_term_months: number | null
          favicon_url: string | null
          font_family: string | null
          footer_text: string | null
          id: string
          login_subtitle: string | null
          login_title: string | null
          mercadopago_checkout_url: string | null
          modules_enabled: Json
          n8n_webhook_url: string | null
          portal_contact_email: string | null
          portal_contact_phone: string | null
          portal_logo_url: string | null
          portal_primary_color: string | null
          portal_require_birth_date: boolean
          portal_subtitle: string | null
          portal_title: string | null
          portal_welcome_message: string | null
          primary_color: string | null
          push_notifications_enabled: boolean | null
          sidebar_style: string | null
          theme_mode: string | null
          user_id: string
          whatsapp_api_key: string | null
          whatsapp_api_url: string | null
          whatsapp_instance: string | null
        }
        Insert: {
          accent_color?: string | null
          border_radius?: string | null
          bot_auto_confirm_payment?: boolean | null
          bot_auto_send?: boolean | null
          bot_business_end?: string | null
          bot_business_hours_only?: boolean | null
          bot_business_start?: string | null
          bot_closing_message?: string | null
          bot_enabled?: boolean | null
          bot_escalation_rules?: Json | null
          bot_greeting_message?: string | null
          bot_max_messages_per_day?: number | null
          bot_negotiation_enabled?: boolean | null
          bot_notify_owner?: boolean | null
          bot_process_audio?: boolean | null
          bot_process_receipts?: boolean | null
          bot_retry_interval_hours?: number | null
          bot_send_audio?: boolean | null
          bot_send_hour?: number | null
          bot_send_minute?: number | null
          bot_send_pix?: boolean | null
          bot_send_receipt?: boolean | null
          bot_stop_on_payment?: boolean | null
          bot_tone?: string | null
          bot_use_ai?: boolean | null
          bot_work_days?: Json | null
          company_address?: string | null
          company_cnpj?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          company_phone?: string | null
          created_at?: string
          custom_contract_template?: string | null
          default_daily_interest?: number | null
          default_frequency?: string | null
          default_interest_rate?: number | null
          default_late_fee?: number | null
          default_max_interest_cap?: number | null
          default_num_installments?: number | null
          default_payment_method?: string | null
          default_term_months?: number | null
          favicon_url?: string | null
          font_family?: string | null
          footer_text?: string | null
          id?: string
          login_subtitle?: string | null
          login_title?: string | null
          mercadopago_checkout_url?: string | null
          modules_enabled?: Json
          n8n_webhook_url?: string | null
          portal_contact_email?: string | null
          portal_contact_phone?: string | null
          portal_logo_url?: string | null
          portal_primary_color?: string | null
          portal_require_birth_date?: boolean
          portal_subtitle?: string | null
          portal_title?: string | null
          portal_welcome_message?: string | null
          primary_color?: string | null
          push_notifications_enabled?: boolean | null
          sidebar_style?: string | null
          theme_mode?: string | null
          user_id: string
          whatsapp_api_key?: string | null
          whatsapp_api_url?: string | null
          whatsapp_instance?: string | null
        }
        Update: {
          accent_color?: string | null
          border_radius?: string | null
          bot_auto_confirm_payment?: boolean | null
          bot_auto_send?: boolean | null
          bot_business_end?: string | null
          bot_business_hours_only?: boolean | null
          bot_business_start?: string | null
          bot_closing_message?: string | null
          bot_enabled?: boolean | null
          bot_escalation_rules?: Json | null
          bot_greeting_message?: string | null
          bot_max_messages_per_day?: number | null
          bot_negotiation_enabled?: boolean | null
          bot_notify_owner?: boolean | null
          bot_process_audio?: boolean | null
          bot_process_receipts?: boolean | null
          bot_retry_interval_hours?: number | null
          bot_send_audio?: boolean | null
          bot_send_hour?: number | null
          bot_send_minute?: number | null
          bot_send_pix?: boolean | null
          bot_send_receipt?: boolean | null
          bot_stop_on_payment?: boolean | null
          bot_tone?: string | null
          bot_use_ai?: boolean | null
          bot_work_days?: Json | null
          company_address?: string | null
          company_cnpj?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          company_phone?: string | null
          created_at?: string
          custom_contract_template?: string | null
          default_daily_interest?: number | null
          default_frequency?: string | null
          default_interest_rate?: number | null
          default_late_fee?: number | null
          default_max_interest_cap?: number | null
          default_num_installments?: number | null
          default_payment_method?: string | null
          default_term_months?: number | null
          favicon_url?: string | null
          font_family?: string | null
          footer_text?: string | null
          id?: string
          login_subtitle?: string | null
          login_title?: string | null
          mercadopago_checkout_url?: string | null
          modules_enabled?: Json
          n8n_webhook_url?: string | null
          portal_contact_email?: string | null
          portal_contact_phone?: string | null
          portal_logo_url?: string | null
          portal_primary_color?: string | null
          portal_require_birth_date?: boolean
          portal_subtitle?: string | null
          portal_title?: string | null
          portal_welcome_message?: string | null
          primary_color?: string | null
          push_notifications_enabled?: boolean | null
          sidebar_style?: string | null
          theme_mode?: string | null
          user_id?: string
          whatsapp_api_key?: string | null
          whatsapp_api_url?: string | null
          whatsapp_instance?: string | null
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          color: string
          cost_price: number
          created_at: string
          id: string
          imei: string
          model: string
          status: string
          storage: string
          user_id: string
        }
        Insert: {
          color: string
          cost_price: number
          created_at?: string
          id?: string
          imei: string
          model: string
          status?: string
          storage: string
          user_id: string
        }
        Update: {
          color?: string
          cost_price?: number
          created_at?: string
          id?: string
          imei?: string
          model?: string
          status?: string
          storage?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount_paid: number | null
          created_at: string | null
          current_period_end: string | null
          email: string
          id: string
          mercadopago_payment_id: string | null
          plan_name: string | null
          plan_tier: string | null
          provider: string | null
          status: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount_paid?: number | null
          created_at?: string | null
          current_period_end?: string | null
          email: string
          id?: string
          mercadopago_payment_id?: string | null
          plan_name?: string | null
          plan_tier?: string | null
          provider?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount_paid?: number | null
          created_at?: string | null
          current_period_end?: string | null
          email?: string
          id?: string
          mercadopago_payment_id?: string | null
          plan_name?: string | null
          plan_tier?: string | null
          provider?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      support_ticket_messages: {
        Row: {
          attachment_url: string | null
          created_at: string
          id: string
          is_internal: boolean
          message: string
          sender_id: string
          sender_name: string
          sender_role: string
          ticket_id: string
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          id?: string
          is_internal?: boolean
          message: string
          sender_id: string
          sender_name: string
          sender_role?: string
          ticket_id: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          id?: string
          is_internal?: boolean
          message?: string
          sender_id?: string
          sender_name?: string
          sender_role?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          ai_category: string | null
          ai_severity: string | null
          ai_suggested_reply: string | null
          ai_triaged_at: string | null
          category: string
          created_at: string
          id: string
          last_message_at: string
          priority: string
          status: string
          subject: string
          unread_by_admin: boolean
          unread_by_user: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_category?: string | null
          ai_severity?: string | null
          ai_suggested_reply?: string | null
          ai_triaged_at?: string | null
          category?: string
          created_at?: string
          id?: string
          last_message_at?: string
          priority?: string
          status?: string
          subject: string
          unread_by_admin?: boolean
          unread_by_user?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_category?: string | null
          ai_severity?: string | null
          ai_suggested_reply?: string | null
          ai_triaged_at?: string | null
          category?: string
          created_at?: string
          id?: string
          last_message_at?: string
          priority?: string
          status?: string
          subject?: string
          unread_by_admin?: boolean
          unread_by_user?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      system_automations: {
        Row: {
          config: Json | null
          created_at: string
          id: string
          last_run: string | null
          name: string
          status: string
          success_rate: number | null
          total_executions: number | null
          type: string
          updated_at: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          id?: string
          last_run?: string | null
          name: string
          status?: string
          success_rate?: number | null
          total_executions?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          id?: string
          last_run?: string | null
          name?: string
          status?: string
          success_rate?: number | null
          total_executions?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      todos: {
        Row: {
          created_at: string
          id: string
          is_complete: boolean
          task: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_complete?: boolean
          task?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_complete?: boolean
          task?: string | null
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          category: string | null
          client_id: string | null
          contract_id: string | null
          created_at: string
          date: string
          description: string
          id: string
          installment_id: string | null
          interest_amount: number
          investor_payment_id: string | null
          investor_loan_id: string | null
          principal_amount: number
          source_key: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string | null
          client_id?: string | null
          contract_id?: string | null
          created_at?: string
          date?: string
          description: string
          fee_amount?: number
          id?: string
          installment_id?: string | null
          interest_amount?: number
          investor_payment_id?: string | null
          investor_loan_id?: string | null
          principal_amount?: number
          source_key?: string | null
          type?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          client_id?: string | null
          contract_id?: string | null
          created_at?: string
          date?: string
          description?: string
          fee_amount?: number
          id?: string
          installment_id?: string | null
          interest_amount?: number
          investor_payment_id?: string | null
          investor_loan_id?: string | null
          principal_amount?: number
          source_key?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "contract_installments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          brand: string
          created_at: string
          id: string
          model: string
          photo_url: string | null
          plate: string
          status: string
          type: string
          user_id: string
          year: number
        }
        Insert: {
          brand: string
          created_at?: string
          id?: string
          model: string
          photo_url?: string | null
          plate: string
          status?: string
          type: string
          user_id: string
          year: number
        }
        Update: {
          brand?: string
          created_at?: string
          id?: string
          model?: string
          photo_url?: string | null
          plate?: string
          status?: string
          type?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      whatsapp_conversations: {
        Row: {
          agent_state: string
          agent_state_data: Json
          agent_state_updated_at: string | null
          blocked: boolean
          bot_paused: boolean
          bot_status: string
          client_id: string | null
          contact_name: string | null
          created_at: string
          followup_sent_at: string | null
          human_takeover_at: string | null
          human_takeover_reason: string | null
          id: string
          instance: string | null
          jid: string
          last_human_handoff_at: string | null
          last_intent: string | null
          last_message_at: string
          last_message_from: string | null
          last_message_preview: string | null
          needs_human: boolean
          phone: string
          tags: string[]
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_state?: string
          agent_state_data?: Json
          agent_state_updated_at?: string | null
          blocked?: boolean
          bot_paused?: boolean
          bot_status?: string
          client_id?: string | null
          contact_name?: string | null
          created_at?: string
          followup_sent_at?: string | null
          human_takeover_at?: string | null
          human_takeover_reason?: string | null
          id?: string
          instance?: string | null
          jid: string
          last_human_handoff_at?: string | null
          last_intent?: string | null
          last_message_at?: string
          last_message_from?: string | null
          last_message_preview?: string | null
          needs_human?: boolean
          phone: string
          tags?: string[]
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_state?: string
          agent_state_data?: Json
          agent_state_updated_at?: string | null
          blocked?: boolean
          bot_paused?: boolean
          bot_status?: string
          client_id?: string | null
          contact_name?: string | null
          created_at?: string
          followup_sent_at?: string | null
          human_takeover_at?: string | null
          human_takeover_reason?: string | null
          id?: string
          instance?: string | null
          jid?: string
          last_human_handoff_at?: string | null
          last_intent?: string | null
          last_message_at?: string
          last_message_from?: string | null
          last_message_preview?: string | null
          needs_human?: boolean
          phone?: string
          tags?: string[]
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_instances: {
        Row: {
          api_key: string
          api_url: string
          created_at: string
          id: string
          instance: string
          is_active: boolean
          is_default: boolean
          name: string
          user_id: string
        }
        Insert: {
          api_key: string
          api_url: string
          created_at?: string
          id?: string
          instance: string
          is_active?: boolean
          is_default?: boolean
          name: string
          user_id: string
        }
        Update: {
          api_key?: string
          api_url?: string
          created_at?: string
          id?: string
          instance?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          direction: string
          id: string
          media_url: string | null
          message_type: string
          metadata: Json | null
          sender: string
          user_id: string
          wa_message_id: string | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          id?: string
          media_url?: string | null
          message_type?: string
          metadata?: Json | null
          sender: string
          user_id: string
          wa_message_id?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          media_url?: string | null
          message_type?: string
          metadata?: Json | null
          sender?: string
          user_id?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_notes: {
        Row: {
          author_name: string | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          author_name?: string | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          author_name?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_scheduled_messages: {
        Row: {
          conversation_id: string
          created_at: string
          error: string | null
          id: string
          scheduled_for: string
          sent_at: string | null
          status: string
          text: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          error?: string | null
          id?: string
          scheduled_for: string
          sent_at?: string | null
          status?: string
          text: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          text?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      settings_safe: {
        Row: {
          accent_color: string | null
          border_radius: string | null
          bot_auto_confirm_payment: boolean | null
          bot_auto_send: boolean | null
          bot_business_end: string | null
          bot_business_hours_only: boolean | null
          bot_business_start: string | null
          bot_closing_message: string | null
          bot_enabled: boolean | null
          bot_escalation_rules: Json | null
          bot_greeting_message: string | null
          bot_max_messages_per_day: number | null
          bot_negotiation_enabled: boolean | null
          bot_notify_owner: boolean | null
          bot_process_audio: boolean | null
          bot_process_receipts: boolean | null
          bot_retry_interval_hours: number | null
          bot_send_audio: boolean | null
          bot_send_hour: number | null
          bot_send_minute: number | null
          bot_send_pix: boolean | null
          bot_send_receipt: boolean | null
          bot_stop_on_payment: boolean | null
          bot_tone: string | null
          bot_use_ai: boolean | null
          bot_work_days: Json | null
          company_address: string | null
          company_cnpj: string | null
          company_logo_url: string | null
          company_name: string | null
          company_phone: string | null
          created_at: string | null
          custom_contract_template: string | null
          default_daily_interest: number | null
          default_frequency: string | null
          default_interest_rate: number | null
          default_late_fee: number | null
          default_max_interest_cap: number | null
          default_num_installments: number | null
          default_payment_method: string | null
          default_term_months: number | null
          favicon_url: string | null
          font_family: string | null
          footer_text: string | null
          id: string | null
          login_subtitle: string | null
          login_title: string | null
          modules_enabled: Json | null
          n8n_webhook_url: string | null
          portal_contact_email: string | null
          portal_contact_phone: string | null
          portal_logo_url: string | null
          portal_primary_color: string | null
          portal_require_birth_date: boolean | null
          portal_subtitle: string | null
          portal_title: string | null
          portal_welcome_message: string | null
          primary_color: string | null
          push_notifications_enabled: boolean | null
          sidebar_style: string | null
          theme_mode: string | null
          user_id: string | null
          whatsapp_api_key_configured: boolean | null
          whatsapp_api_url: string | null
          whatsapp_instance: string | null
        }
        Insert: {
          accent_color?: string | null
          border_radius?: string | null
          bot_auto_confirm_payment?: boolean | null
          bot_auto_send?: boolean | null
          bot_business_end?: string | null
          bot_business_hours_only?: boolean | null
          bot_business_start?: string | null
          bot_closing_message?: string | null
          bot_enabled?: boolean | null
          bot_escalation_rules?: Json | null
          bot_greeting_message?: string | null
          bot_max_messages_per_day?: number | null
          bot_negotiation_enabled?: boolean | null
          bot_notify_owner?: boolean | null
          bot_process_audio?: boolean | null
          bot_process_receipts?: boolean | null
          bot_retry_interval_hours?: number | null
          bot_send_audio?: boolean | null
          bot_send_hour?: number | null
          bot_send_minute?: number | null
          bot_send_pix?: boolean | null
          bot_send_receipt?: boolean | null
          bot_stop_on_payment?: boolean | null
          bot_tone?: string | null
          bot_use_ai?: boolean | null
          bot_work_days?: Json | null
          company_address?: string | null
          company_cnpj?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          company_phone?: string | null
          created_at?: string | null
          custom_contract_template?: string | null
          default_daily_interest?: number | null
          default_frequency?: string | null
          default_interest_rate?: number | null
          default_late_fee?: number | null
          default_max_interest_cap?: number | null
          default_num_installments?: number | null
          default_payment_method?: string | null
          default_term_months?: number | null
          favicon_url?: string | null
          font_family?: string | null
          footer_text?: string | null
          id?: string | null
          login_subtitle?: string | null
          login_title?: string | null
          modules_enabled?: Json | null
          n8n_webhook_url?: string | null
          portal_contact_email?: string | null
          portal_contact_phone?: string | null
          portal_logo_url?: string | null
          portal_primary_color?: string | null
          portal_require_birth_date?: boolean | null
          portal_subtitle?: string | null
          portal_title?: string | null
          portal_welcome_message?: string | null
          primary_color?: string | null
          push_notifications_enabled?: boolean | null
          sidebar_style?: string | null
          theme_mode?: string | null
          user_id?: string | null
          whatsapp_api_key_configured?: never
          whatsapp_api_url?: string | null
          whatsapp_instance?: string | null
        }
        Update: {
          accent_color?: string | null
          border_radius?: string | null
          bot_auto_confirm_payment?: boolean | null
          bot_auto_send?: boolean | null
          bot_business_end?: string | null
          bot_business_hours_only?: boolean | null
          bot_business_start?: string | null
          bot_closing_message?: string | null
          bot_enabled?: boolean | null
          bot_escalation_rules?: Json | null
          bot_greeting_message?: string | null
          bot_max_messages_per_day?: number | null
          bot_negotiation_enabled?: boolean | null
          bot_notify_owner?: boolean | null
          bot_process_audio?: boolean | null
          bot_process_receipts?: boolean | null
          bot_retry_interval_hours?: number | null
          bot_send_audio?: boolean | null
          bot_send_hour?: number | null
          bot_send_minute?: number | null
          bot_send_pix?: boolean | null
          bot_send_receipt?: boolean | null
          bot_stop_on_payment?: boolean | null
          bot_tone?: string | null
          bot_use_ai?: boolean | null
          bot_work_days?: Json | null
          company_address?: string | null
          company_cnpj?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          company_phone?: string | null
          created_at?: string | null
          custom_contract_template?: string | null
          default_daily_interest?: number | null
          default_frequency?: string | null
          default_interest_rate?: number | null
          default_late_fee?: number | null
          default_max_interest_cap?: number | null
          default_num_installments?: number | null
          default_payment_method?: string | null
          default_term_months?: number | null
          favicon_url?: string | null
          font_family?: string | null
          footer_text?: string | null
          id?: string | null
          login_subtitle?: string | null
          login_title?: string | null
          modules_enabled?: Json | null
          n8n_webhook_url?: string | null
          portal_contact_email?: string | null
          portal_contact_phone?: string | null
          portal_logo_url?: string | null
          portal_primary_color?: string | null
          portal_require_birth_date?: boolean | null
          portal_subtitle?: string | null
          portal_title?: string | null
          portal_welcome_message?: string | null
          primary_color?: string | null
          push_notifications_enabled?: boolean | null
          sidebar_style?: string | null
          theme_mode?: string | null
          user_id?: string | null
          whatsapp_api_key_configured?: never
          whatsapp_api_url?: string | null
          whatsapp_instance?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_set_user_admin: {
        Args: { _make_admin: boolean; _target_user_id: string }
        Returns: undefined
      }
      can_access_chat_topic: {
        Args: { _topic: string; _user_id: string }
        Returns: boolean
      }
      collector_login_by_token: { Args: { _token: string }; Returns: Json }
      collector_register_payment: {
        Args: {
          _installment_id: string
          _method?: string
          _paid_total: number
          _receipt_url?: string
          _source_key?: string
          _token: string
        }
        Returns: Json
      }
      create_client_contract: {
        Args: {
          _client: Json
          _client_id: string | null
          _contract: Json
          _installments: Json
        }
        Returns: Json
      }
      delete_client_cascade: {
        Args: { _client_id: string }
        Returns: undefined
      }
      get_ativo_passivo: { Args: never; Returns: Json }
      get_or_create_dm_thread: {
        Args: { _other_user: string }
        Returns: string
      }
      get_signup_checkout_url: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      investor_portal_login: { Args: { _token: string }; Returns: Json }
      investor_regenerate_token: {
        Args: { _investor_id: string }
        Returns: string
      }
      increment_goal_amount: {
        Args: { _delta: number; _goal_id: string }
        Returns: number
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_channel_member: {
        Args: { _channel_id: string; _user_id: string }
        Returns: boolean
      }
      is_dm_participant: {
        Args: { _thread_id: string; _user_id: string }
        Returns: boolean
      }
      list_public_profiles: {
        Args: never
        Returns: {
          avatar_url: string
          id: string
          is_admin: boolean
          is_chat_blocked: boolean
          name: string
        }[]
      }
      pay_installment: {
        Args: {
          _installment_id: string
          _mark_paid?: boolean
          _method?: string
          _paid_total: number
          _receipt_url?: string
        }
        Returns: Json
      }
      pay_installment_waiving_fees: {
        Args: {
          _installment_id: string
          _method?: string
          _paid_total: number
          _receipt_url?: string
        }
        Returns: Json
      }
      register_investor_payment: {
        Args: {
          _amount: number
          _loan_id: string
          _method?: string
          _notes?: string
          _receipt_url?: string
        }
        Returns: Json
      }
      portal_client_login: {
        Args: { _birth_date?: string; _cpf: string }
        Returns: Json
      }
      portal_client_login_for_owner: {
        Args: { _birth_date: string; _cpf: string; _owner_id: string }
        Returns: Json
      }
      portal_client_mark_notifications_read: {
        Args: { _cpf: string; _ids?: string[] }
        Returns: number
      }
      portal_client_notifications: {
        Args: { _cpf: string; _limit?: number }
        Returns: Json
      }
      portal_login_by_token: { Args: { _token: string }; Returns: Json }
      portal_lookup_creditor_contact:
        | { Args: { _cpf: string }; Returns: Json }
        | { Args: { _birth_date: string; _cpf: string }; Returns: Json }
      portal_mark_notifications_read_by_token: {
        Args: { _ids?: string[]; _token: string }
        Returns: number
      }
      portal_notifications_by_token: {
        Args: { _limit?: number; _token: string }
        Returns: Json
      }
      reverse_installment_payment: {
        Args: { _installment_id: string }
        Returns: Json
      }
      reverse_last_investor_payment: {
        Args: { _loan_id: string }
        Returns: Json
      }
      search_clients_by_document: {
        Args: { _document: string }
        Returns: {
          avatar_url: string
          cpf_cnpj: string
          email: string
          id: string
          name: string
          phone: string
          status: string
        }[]
      }
      search_clients_fuzzy: {
        Args: { _limit?: number; _term: string; _threshold?: number }
        Returns: {
          avatar_url: string
          cpf_cnpj: string
          email: string
          id: string
          name: string
          phone: string
          similarity: number
          status: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      system_register_payment: {
        Args: {
          _installment_id: string
          _method?: string
          _origem?: string
          _paid_total: number
          _receipt_url?: string
        }
        Returns: Json
      }
      try_consume_rate_limit: {
        Args: { _capacity: number; _key: string; _refill_per_sec: number }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "operator" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operator", "viewer"],
    },
  },
} as const
