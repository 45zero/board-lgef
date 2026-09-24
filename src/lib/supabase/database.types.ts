// Généré par introspection SQL directe (information_schema + pg_catalog) sur le
// projet Supabase ofyxybcxvhqwkemskldl, schéma "public" — la CLI officielle
// (`supabase gen types`) restait bloquée indéfiniment dans cet environnement
// (bloqué après la lecture de ~/.supabase/profile, cause non identifiée, sans
// rapport avec la connexion DB elle-même qui fonctionne — testée via psql).
//
// Régénérer proprement dès que possible avec :
//   npx supabase gen types typescript --project-id ofyxybcxvhqwkemskldl --schema public
// (ou --db-url) une fois la CLI utilisable dans l'environnement de dev.
//
// Le schéma "public" est partagé avec lgef-quiz- (même projet Supabase) : les
// tables quiz_*, specialties, cards, boards, etc. y apparaissent aussi.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      account_requests: {
        Row: {
          id: string
          email: string
          first_name: string
          last_name: string
          phone: string | null
          organization: string | null
          role_requested: string | null
          reason: string | null
          status: string | null
          created_at: string
          updated_at: string
          reviewed_by: string | null
          reviewed_at: string | null
        }
        Insert: {
          id?: string
          email: string
          first_name: string
          last_name: string
          phone?: string | null
          organization?: string | null
          role_requested?: string | null
          reason?: string | null
          status?: string | null
          created_at?: string
          updated_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          first_name?: string
          last_name?: string
          phone?: string | null
          organization?: string | null
          role_requested?: string | null
          reason?: string | null
          status?: string | null
          created_at?: string
          updated_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
        }
        Relationships: []
      }
      ai_r1_homiris_context: {
        Row: {
          id: string
          data: Json
          updated_at: string | null
        }
        Insert: {
          id?: string
          data: Json
          updated_at?: string | null
        }
        Update: {
          id?: string
          data?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      assignments: {
        Row: {
          id: string
          event_id: string | null
          technician_id: string | null
          assigned_by: string | null
          assigned_at: string | null
          status: string | null
          notes: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          event_id?: string | null
          technician_id?: string | null
          assigned_by?: string | null
          assigned_at?: string | null
          status?: string | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          event_id?: string | null
          technician_id?: string | null
          assigned_by?: string | null
          assigned_at?: string | null
          status?: string | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      board_members: {
        Row: {
          id: string
          board_id: string | null
          user_id: string | null
          role: string | null
          added_at: string | null
          added_by: string | null
        }
        Insert: {
          id?: string
          board_id?: string | null
          user_id?: string | null
          role?: string | null
          added_at?: string | null
          added_by?: string | null
        }
        Update: {
          id?: string
          board_id?: string | null
          user_id?: string | null
          role?: string | null
          added_at?: string | null
          added_by?: string | null
        }
        Relationships: []
      }
      board_shares: {
        Row: {
          id: string
          board_id: string | null
          user_id: string | null
          shared_at: string | null
        }
        Insert: {
          id?: string
          board_id?: string | null
          user_id?: string | null
          shared_at?: string | null
        }
        Update: {
          id?: string
          board_id?: string | null
          user_id?: string | null
          shared_at?: string | null
        }
        Relationships: []
      }
      media_publications: {
        Row: {
          id: string
          event_file_id: string
          event_id: string
          status: string
          scheduled_at: string | null
          caption: string | null
          targets: Json
          created_by: string | null
          created_at: string
          published_at: string | null
        }
        Insert: {
          id?: string
          event_file_id: string
          event_id: string
          status?: string
          scheduled_at?: string | null
          caption?: string | null
          targets?: Json
          created_by?: string | null
          created_at?: string
          published_at?: string | null
        }
        Update: {
          id?: string
          event_file_id?: string
          event_id?: string
          status?: string
          scheduled_at?: string | null
          caption?: string | null
          targets?: Json
          created_by?: string | null
          created_at?: string
          published_at?: string | null
        }
        Relationships: []
      }
      board_settings: {
        Row: {
          id: boolean
          drive_connected_account_id: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          drive_connected_account_id?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          drive_connected_account_id?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      boards: {
        Row: {
          id: string
          event_id: string | null
          title: string
          description: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          is_open_join: boolean
        }
        Insert: {
          id?: string
          event_id?: string | null
          title: string
          description?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          is_open_join?: boolean
        }
        Update: {
          id?: string
          event_id?: string | null
          title?: string
          description?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          is_open_join?: boolean
        }
        Relationships: []
      }
      card_checklist_items: {
        Row: {
          id: string
          checklist_id: string
          content: string
          completed: boolean
          created_at: string
        }
        Insert: {
          id?: string
          checklist_id: string
          content: string
          completed?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          checklist_id?: string
          content?: string
          completed?: boolean
          created_at?: string
        }
        Relationships: []
      }
      card_checklists: {
        Row: {
          id: string
          card_id: string
          title: string
          created_at: string
          position: number | null
        }
        Insert: {
          id?: string
          card_id: string
          title?: string
          created_at?: string
          position?: number | null
        }
        Update: {
          id?: string
          card_id?: string
          title?: string
          created_at?: string
          position?: number | null
        }
        Relationships: []
      }
      card_comments: {
        Row: {
          id: string
          card_id: string | null
          user_id: string | null
          content: string
          mentions: string[] | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          card_id?: string | null
          user_id?: string | null
          content: string
          mentions?: string[] | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          card_id?: string | null
          user_id?: string | null
          content?: string
          mentions?: string[] | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      card_labels: {
        Row: {
          id: string
          card_id: string | null
          name: string
          color: Database["public"]["Enums"]["label_color"]
          created_at: string | null
        }
        Insert: {
          id?: string
          card_id?: string | null
          name: string
          color: Database["public"]["Enums"]["label_color"]
          created_at?: string | null
        }
        Update: {
          id?: string
          card_id?: string | null
          name?: string
          color?: Database["public"]["Enums"]["label_color"]
          created_at?: string | null
        }
        Relationships: []
      }
      card_member_chips: {
        Row: {
          card_id: string
          user_id: string
          assigned_at: string | null
          first_name: string | null
          last_name: string | null
          avatar_url: string | null
        }
        Insert: {
          card_id: string
          user_id: string
          assigned_at?: string | null
          first_name?: string | null
          last_name?: string | null
          avatar_url?: string | null
        }
        Update: {
          card_id?: string
          user_id?: string
          assigned_at?: string | null
          first_name?: string | null
          last_name?: string | null
          avatar_url?: string | null
        }
        Relationships: []
      }
      card_members: {
        Row: {
          id: string
          card_id: string
          user_id: string
          assigned_at: string | null
          assigned_by: string | null
        }
        Insert: {
          id?: string
          card_id: string
          user_id: string
          assigned_at?: string | null
          assigned_by?: string | null
        }
        Update: {
          id?: string
          card_id?: string
          user_id?: string
          assigned_at?: string | null
          assigned_by?: string | null
        }
        Relationships: []
      }
      cards: {
        Row: {
          id: string
          list_id: string | null
          title: string
          description: string | null
          position: number
          assigned_to: string | null
          due_date: string | null
          completed: boolean | null
          created_at: string | null
          updated_at: string | null
          cover_color: string | null
          visibility: Database["public"]["Enums"]["card_visibility"] | null
          sync_to_calendar: boolean | null
          creator_id: string | null
          mentions: string[] | null
          created_by: string | null
          board_id: string
        }
        Insert: {
          id?: string
          list_id?: string | null
          title: string
          description?: string | null
          position?: number
          assigned_to?: string | null
          due_date?: string | null
          completed?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          cover_color?: string | null
          visibility?: Database["public"]["Enums"]["card_visibility"] | null
          sync_to_calendar?: boolean | null
          creator_id?: string | null
          mentions?: string[] | null
          created_by?: string | null
          board_id: string
        }
        Update: {
          id?: string
          list_id?: string | null
          title?: string
          description?: string | null
          position?: number
          assigned_to?: string | null
          due_date?: string | null
          completed?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          cover_color?: string | null
          visibility?: Database["public"]["Enums"]["card_visibility"] | null
          sync_to_calendar?: boolean | null
          creator_id?: string | null
          mentions?: string[] | null
          created_by?: string | null
          board_id?: string
        }
        Relationships: []
      }
      checklist_items: {
        Row: {
          id: string
          card_id: string | null
          title: string
          completed: boolean | null
          position: number
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          card_id?: string | null
          title: string
          completed?: boolean | null
          position?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          card_id?: string | null
          title?: string
          completed?: boolean | null
          position?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      communication_action_events: {
        Row: {
          id: string
          action_id: string
          event_id: string
          created_at: string | null
        }
        Insert: {
          id?: string
          action_id: string
          event_id: string
          created_at?: string | null
        }
        Update: {
          id?: string
          action_id?: string
          event_id?: string
          created_at?: string | null
        }
        Relationships: []
      }
      communication_actions: {
        Row: {
          id: string
          name: string
          description: string | null
          event_type: string
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          event_type: string
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          event_type?: string
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      coverage_requests: {
        Row: {
          id: string
          event_id: string | null
          requester_id: string | null
          status: Database["public"]["Enums"]["coverage_request_status"] | null
          details: string | null
          approved_by: string | null
          approved_at: string | null
          created_at: string | null
          updated_at: string | null
          assigned_technician_id: string | null
          assigned_technician_name: string | null
          assigned_technician_email: string | null
          assigned_technician_phone: string | null
          coverage_symbol: string | null
          comment: string | null
          attachments: Json | null
          active: boolean | null
          technician_response: string | null
          technician_response_date: string | null
          technician_response_notes: string | null
          technician_id: string | null
          responded_at: string | null
          refused_by_name: string | null
          cancelled_by: string | null
          cancelled_at: string | null
        }
        Insert: {
          id?: string
          event_id?: string | null
          requester_id?: string | null
          status?: Database["public"]["Enums"]["coverage_request_status"] | null
          details?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          assigned_technician_id?: string | null
          assigned_technician_name?: string | null
          assigned_technician_email?: string | null
          assigned_technician_phone?: string | null
          coverage_symbol?: string | null
          comment?: string | null
          attachments?: Json | null
          active?: boolean | null
          technician_response?: string | null
          technician_response_date?: string | null
          technician_response_notes?: string | null
          technician_id?: string | null
          responded_at?: string | null
          refused_by_name?: string | null
          cancelled_by?: string | null
          cancelled_at?: string | null
        }
        Update: {
          id?: string
          event_id?: string | null
          requester_id?: string | null
          status?: Database["public"]["Enums"]["coverage_request_status"] | null
          details?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          assigned_technician_id?: string | null
          assigned_technician_name?: string | null
          assigned_technician_email?: string | null
          assigned_technician_phone?: string | null
          coverage_symbol?: string | null
          comment?: string | null
          attachments?: Json | null
          active?: boolean | null
          technician_response?: string | null
          technician_response_date?: string | null
          technician_response_notes?: string | null
          technician_id?: string | null
          responded_at?: string | null
          refused_by_name?: string | null
          cancelled_by?: string | null
          cancelled_at?: string | null
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          id: string
          user_id: string
          token: string
          platform: string | null
          is_active: boolean
          last_seen_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          token: string
          platform?: string | null
          is_active?: boolean
          last_seen_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          token?: string
          platform?: string | null
          is_active?: boolean
          last_seen_at?: string | null
        }
        Relationships: []
      }
      director_attendance: {
        Row: {
          id: string
          event_id: string
          director_id: string | null
          comments: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          status: string | null
        }
        Insert: {
          id?: string
          event_id: string
          director_id?: string | null
          comments?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          status?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          director_id?: string | null
          comments?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          status?: string | null
        }
        Relationships: []
      }
      employees: {
        Row: {
          id: string
          first_name: string | null
          last_name: string | null
          email: string
          phone: string | null
          job_title: string | null
          active: boolean | null
          created_at: string | null
          profile_id: string | null
        }
        Insert: {
          id?: string
          first_name?: string | null
          last_name?: string | null
          email: string
          phone?: string | null
          job_title?: string | null
          active?: boolean | null
          created_at?: string | null
          profile_id?: string | null
        }
        Update: {
          id?: string
          first_name?: string | null
          last_name?: string | null
          email?: string
          phone?: string | null
          job_title?: string | null
          active?: boolean | null
          created_at?: string | null
          profile_id?: string | null
        }
        Relationships: []
      }
      event_assignments: {
        Row: {
          id: string
          event_id: string
          user_id: string
          assigned_at: string | null
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          assigned_at?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          assigned_at?: string | null
        }
        Relationships: []
      }
      event_comment_reactions: {
        Row: {
          comment_id: string
          user_id: string
          type: string
          created_at: string
        }
        Insert: {
          comment_id: string
          user_id: string
          type?: string
          created_at?: string
        }
        Update: {
          comment_id?: string
          user_id?: string
          type?: string
          created_at?: string
        }
        Relationships: []
      }
      event_comment_reads: {
        Row: {
          comment_id: string
          user_id: string
          read_at: string
        }
        Insert: {
          comment_id: string
          user_id: string
          read_at?: string
        }
        Update: {
          comment_id?: string
          user_id?: string
          read_at?: string
        }
        Relationships: []
      }
      event_comments: {
        Row: {
          id: string
          event_id: string
          author_id: string
          body: string
          mentions: string[] | null
          created_at: string
          parent_id: string | null
        }
        Insert: {
          id?: string
          event_id: string
          author_id: string
          body: string
          mentions?: string[] | null
          created_at?: string
          parent_id?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          author_id?: string
          body?: string
          mentions?: string[] | null
          created_at?: string
          parent_id?: string | null
        }
        Relationships: []
      }
      event_discussion_participants: {
        Row: {
          event_id: string
          user_id: string
          created_at: string | null
        }
        Insert: {
          event_id: string
          user_id: string
          created_at?: string | null
        }
        Update: {
          event_id?: string
          user_id?: string
          created_at?: string | null
        }
        Relationships: []
      }
      event_expense_attachments: {
        Row: {
          id: string
          expense_id: string | null
          file_url: string
          file_type: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          expense_id?: string | null
          file_url: string
          file_type?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          expense_id?: string | null
          file_url?: string
          file_type?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      event_expenses: {
        Row: {
          id: string
          event_id: string | null
          user_id: string
          toll_fees: number | null
          meal_fees: number | null
          other_fees: number | null
          other_fees_description: string | null
          created_at: string
          updated_at: string
          total_amount: number | null
          transport_fees: number | null
          parking_fees: number | null
          car_rental_fees: number | null
          fuel_fees: number | null
          hotel_fees: number | null
          description: string | null
          arrival_time: string | null
          departure_time: string | null
          distance_km: number | null
          file_url: string | null
          expense_date: string | null
          merchant_name: string | null
        }
        Insert: {
          id?: string
          event_id?: string | null
          user_id: string
          toll_fees?: number | null
          meal_fees?: number | null
          other_fees?: number | null
          other_fees_description?: string | null
          created_at?: string
          updated_at?: string
          total_amount?: number | null
          transport_fees?: number | null
          parking_fees?: number | null
          car_rental_fees?: number | null
          fuel_fees?: number | null
          hotel_fees?: number | null
          description?: string | null
          arrival_time?: string | null
          departure_time?: string | null
          distance_km?: number | null
          file_url?: string | null
          expense_date?: string | null
          merchant_name?: string | null
        }
        Update: {
          id?: string
          event_id?: string | null
          user_id?: string
          toll_fees?: number | null
          meal_fees?: number | null
          other_fees?: number | null
          other_fees_description?: string | null
          created_at?: string
          updated_at?: string
          total_amount?: number | null
          transport_fees?: number | null
          parking_fees?: number | null
          car_rental_fees?: number | null
          fuel_fees?: number | null
          hotel_fees?: number | null
          description?: string | null
          arrival_time?: string | null
          departure_time?: string | null
          distance_km?: number | null
          file_url?: string | null
          expense_date?: string | null
          merchant_name?: string | null
        }
        Relationships: []
      }
      event_file_share_items: {
        Row: {
          id: string
          share_id: string
          file_path: string
          filename: string
          created_at: string | null
        }
        Insert: {
          id?: string
          share_id: string
          file_path: string
          filename: string
          created_at?: string | null
        }
        Update: {
          id?: string
          share_id?: string
          file_path?: string
          filename?: string
          created_at?: string | null
        }
        Relationships: []
      }
      event_file_shares: {
        Row: {
          id: string
          file_id: string | null
          token: string
          expires_at: string
          created_at: string | null
          revoked: boolean | null
          views_count: number | null
          file_path: string | null
          filename: string | null
          message: string | null
        }
        Insert: {
          id?: string
          file_id?: string | null
          token: string
          expires_at: string
          created_at?: string | null
          revoked?: boolean | null
          views_count?: number | null
          file_path?: string | null
          filename?: string | null
          message?: string | null
        }
        Update: {
          id?: string
          file_id?: string | null
          token?: string
          expires_at?: string
          created_at?: string | null
          revoked?: boolean | null
          views_count?: number | null
          file_path?: string | null
          filename?: string | null
          message?: string | null
        }
        Relationships: []
      }
      event_files: {
        Row: {
          id: string
          event_id: string
          path: string | null
          filename: string
          content_type: string | null
          size_bytes: number | null
          created_at: string
          uploaded_by: string
          publish_info: Json | null
          storage_provider: string
          drive_file_id: string | null
          drive_web_view_link: string | null
        }
        Insert: {
          id?: string
          event_id: string
          path?: string | null
          filename: string
          content_type?: string | null
          size_bytes?: number | null
          created_at?: string
          uploaded_by?: string
          publish_info?: Json | null
          storage_provider?: string
          drive_file_id?: string | null
          drive_web_view_link?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          path?: string | null
          filename?: string
          content_type?: string | null
          size_bytes?: number | null
          created_at?: string
          uploaded_by?: string
          publish_info?: Json | null
          storage_provider?: string
          drive_file_id?: string | null
          drive_web_view_link?: string | null
        }
        Relationships: []
      }
      event_invoice_attachments: {
        Row: {
          id: string
          invoice_id: string | null
          file_url: string
          custom_name: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          invoice_id?: string | null
          file_url: string
          custom_name?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          invoice_id?: string | null
          file_url?: string
          custom_name?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      event_invoices: {
        Row: {
          id: string
          event_id: string | null
          user_id: string | null
          amount_ttc: number
          file_url: string | null
          status: string
          admin_comment: string | null
          created_at: string | null
          updated_at: string | null
          user_comment: string | null
          prestataire_comment: string | null
          comments: string | null
          payment_status: string | null
          paid_at: string | null
          submitted_at: string | null
        }
        Insert: {
          id?: string
          event_id?: string | null
          user_id?: string | null
          amount_ttc: number
          file_url?: string | null
          status?: string
          admin_comment?: string | null
          created_at?: string | null
          updated_at?: string | null
          user_comment?: string | null
          prestataire_comment?: string | null
          comments?: string | null
          payment_status?: string | null
          paid_at?: string | null
          submitted_at?: string | null
        }
        Update: {
          id?: string
          event_id?: string | null
          user_id?: string | null
          amount_ttc?: number
          file_url?: string | null
          status?: string
          admin_comment?: string | null
          created_at?: string | null
          updated_at?: string | null
          user_comment?: string | null
          prestataire_comment?: string | null
          comments?: string | null
          payment_status?: string | null
          paid_at?: string | null
          submitted_at?: string | null
        }
        Relationships: []
      }
      event_reminders: {
        Row: {
          id: string
          event_id: string
          user_id: string
          remind_at: string
          reminder_offset: string
          channels: string[]
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          remind_at: string
          reminder_offset: string
          channels?: string[]
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          remind_at?: string
          reminder_offset?: string
          channels?: string[]
          sent_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      event_team_members: {
        Row: {
          id: string
          event_id: string
          user_id: string
          role: string
          created_at: string | null
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          role: string
          created_at?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          role?: string
          created_at?: string | null
        }
        Relationships: []
      }
      event_registration_campaigns: {
        Row: {
          id: string
          event_id: string
          subject: string
          message: string
          image_url: string | null
          video_url: string | null
          links: Json
          public_token: string
          status: string
          created_by: string | null
          created_at: string
          updated_at: string
          invitation_card_url: string | null
          banner_url: string | null
          pdf_url: string | null
          pdf_filename: string | null
          parking_label: string | null
          parking_address: string | null
          signatory_name: string | null
          signatory_title: string | null
          signature_image_url: string | null
          blocks: Json
        }
        Insert: {
          id?: string
          event_id: string
          subject?: string
          message?: string
          image_url?: string | null
          video_url?: string | null
          links?: Json
          public_token?: string
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
          invitation_card_url?: string | null
          banner_url?: string | null
          pdf_url?: string | null
          pdf_filename?: string | null
          parking_label?: string | null
          parking_address?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          signature_image_url?: string | null
          blocks?: Json
        }
        Update: {
          id?: string
          event_id?: string
          subject?: string
          message?: string
          image_url?: string | null
          video_url?: string | null
          links?: Json
          public_token?: string
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
          invitation_card_url?: string | null
          banner_url?: string | null
          pdf_url?: string | null
          pdf_filename?: string | null
          parking_label?: string | null
          parking_address?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          signature_image_url?: string | null
          blocks?: Json
        }
        Relationships: []
      }
      event_registration_recipients: {
        Row: {
          id: string
          campaign_id: string
          token: string
          contact_id: string | null
          name: string
          email: string | null
          club: string | null
          source: string
          sent_at: string | null
          response: string | null
          responded_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          token?: string
          contact_id?: string | null
          name?: string
          email?: string | null
          club?: string | null
          source?: string
          sent_at?: string | null
          response?: string | null
          responded_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          token?: string
          contact_id?: string | null
          name?: string
          email?: string | null
          club?: string | null
          source?: string
          sent_at?: string | null
          response?: string | null
          responded_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          id: string
          title: string
          description: string | null
          start_date: string
          end_date: string
          location: string | null
          organizer_id: string | null
          status: Database["public"]["Enums"]["event_status"] | null
          requires_coverage: boolean | null
          created_at: string | null
          updated_at: string | null
          event_type: Database["public"]["Enums"]["event_type"] | null
          visibility: string
          board_id: string | null
          calendar_card_id: string | null
          type: string
          created_by: string | null
          show_in_calendar: boolean | null
          event_address: string | null
          event_coordinates: Json | null
          organizer_message: string | null
          updated_by: string | null
          google_event_id: string | null
          google_calendar_id: string | null
          google_connected_account_id: string | null
          online_meeting: boolean
          registration_enabled: boolean
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          start_date: string
          end_date: string
          location?: string | null
          organizer_id?: string | null
          status?: Database["public"]["Enums"]["event_status"] | null
          requires_coverage?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          event_type?: Database["public"]["Enums"]["event_type"] | null
          visibility?: string
          board_id?: string | null
          calendar_card_id?: string | null
          type?: string
          created_by?: string | null
          show_in_calendar?: boolean | null
          event_address?: string | null
          event_coordinates?: Json | null
          organizer_message?: string | null
          updated_by?: string | null
          google_event_id?: string | null
          google_calendar_id?: string | null
          google_connected_account_id?: string | null
          online_meeting?: boolean
          registration_enabled?: boolean
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          start_date?: string
          end_date?: string
          location?: string | null
          organizer_id?: string | null
          status?: Database["public"]["Enums"]["event_status"] | null
          requires_coverage?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          event_type?: Database["public"]["Enums"]["event_type"] | null
          visibility?: string
          board_id?: string | null
          calendar_card_id?: string | null
          type?: string
          created_by?: string | null
          show_in_calendar?: boolean | null
          event_address?: string | null
          event_coordinates?: Json | null
          organizer_message?: string | null
          updated_by?: string | null
          google_event_id?: string | null
          google_calendar_id?: string | null
          google_connected_account_id?: string | null
          online_meeting?: boolean
          registration_enabled?: boolean
        }
        Relationships: []
      }
      events_audit: {
        Row: {
          id: number
          ts: string | null
          action: string | null
          event_id: string | null
          old_calendar_card_id: string | null
          new_calendar_card_id: string | null
          old_show_in_calendar: boolean | null
          new_show_in_calendar: boolean | null
          jwt_uid: string | null
          txid: number | null
        }
        Insert: {
          id?: number
          ts?: string | null
          action?: string | null
          event_id?: string | null
          old_calendar_card_id?: string | null
          new_calendar_card_id?: string | null
          old_show_in_calendar?: boolean | null
          new_show_in_calendar?: boolean | null
          jwt_uid?: string | null
          txid?: number | null
        }
        Update: {
          id?: number
          ts?: string | null
          action?: string | null
          event_id?: string | null
          old_calendar_card_id?: string | null
          new_calendar_card_id?: string | null
          old_show_in_calendar?: boolean | null
          new_show_in_calendar?: boolean | null
          jwt_uid?: string | null
          txid?: number | null
        }
        Relationships: []
      }
      expense_attachments: {
        Row: {
          id: string
          submission_id: string | null
          file_url: string
          file_type: string | null
          created_at: string | null
          custom_name: string | null
          expense_id: string | null
        }
        Insert: {
          id?: string
          submission_id?: string | null
          file_url: string
          file_type?: string | null
          created_at?: string | null
          custom_name?: string | null
          expense_id?: string | null
        }
        Update: {
          id?: string
          submission_id?: string | null
          file_url?: string
          file_type?: string | null
          created_at?: string | null
          custom_name?: string | null
          expense_id?: string | null
        }
        Relationships: []
      }
      expense_documents: {
        Row: {
          id: string
          expense_id: string | null
          profile_id: string | null
          event_id: string | null
          document_type: string
          file_name: string
          file_path: string
          file_size: number | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          expense_id?: string | null
          profile_id?: string | null
          event_id?: string | null
          document_type: string
          file_name: string
          file_path: string
          file_size?: number | null
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          expense_id?: string | null
          profile_id?: string | null
          event_id?: string | null
          document_type?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          uploaded_by?: string
          created_at?: string
        }
        Relationships: []
      }
      expense_submissions: {
        Row: {
          id: string
          user_id: string
          event_id: string
          expense_ids: string[]
          total_amount: number
          status: string
          comments: string | null
          submitted_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_comments: string | null
          created_at: string
          updated_at: string
          toll_fees: number | null
          meal_fees: number | null
          other_fees: number | null
          other_fees_description: string | null
          distance_km: number | null
          duration_minutes: number | null
          reviewer_comment: string | null
          notified_at: string | null
          notified_month: string | null
        }
        Insert: {
          id?: string
          user_id: string
          event_id: string
          expense_ids?: string[]
          total_amount?: number
          status?: string
          comments?: string | null
          submitted_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_comments?: string | null
          created_at?: string
          updated_at?: string
          toll_fees?: number | null
          meal_fees?: number | null
          other_fees?: number | null
          other_fees_description?: string | null
          distance_km?: number | null
          duration_minutes?: number | null
          reviewer_comment?: string | null
          notified_at?: string | null
          notified_month?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          event_id?: string
          expense_ids?: string[]
          total_amount?: number
          status?: string
          comments?: string | null
          submitted_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_comments?: string | null
          created_at?: string
          updated_at?: string
          toll_fees?: number | null
          meal_fees?: number | null
          other_fees?: number | null
          other_fees_description?: string | null
          distance_km?: number | null
          duration_minutes?: number | null
          reviewer_comment?: string | null
          notified_at?: string | null
          notified_month?: string | null
        }
        Relationships: []
      }
      fcm_tokens: {
        Row: {
          id: string
          user_id: string
          token: string
          device_platform: string | null
          device_model: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          token: string
          device_platform?: string | null
          device_model?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          token?: string
          device_platform?: string | null
          device_model?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      fixtures_catalog_raw: {
        Row: {
          id: number
          "Poule(code)": string | null
          "Nom abrégé": string | null
          Poule: string | null
          "Numéro de journée": string | null
          "Equipe recevante(nom)": string | null
          "Equipe visiteuse(nom)": string | null
          Jour: string | null
          "Date de match": string | null
          Heure: string | null
          "Code postal": string | null
          "Localité": string | null
          "Nom de l'installation": string | null
          "Voie-rue": string | null
          Garder: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          "Poule(code)"?: string | null
          "Nom abrégé"?: string | null
          Poule?: string | null
          "Numéro de journée"?: string | null
          "Equipe recevante(nom)"?: string | null
          "Equipe visiteuse(nom)"?: string | null
          Jour?: string | null
          "Date de match"?: string | null
          Heure?: string | null
          "Code postal"?: string | null
          "Localité"?: string | null
          "Nom de l'installation"?: string | null
          "Voie-rue"?: string | null
          Garder?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          "Poule(code)"?: string | null
          "Nom abrégé"?: string | null
          Poule?: string | null
          "Numéro de journée"?: string | null
          "Equipe recevante(nom)"?: string | null
          "Equipe visiteuse(nom)"?: string | null
          Jour?: string | null
          "Date de match"?: string | null
          Heure?: string | null
          "Code postal"?: string | null
          "Localité"?: string | null
          "Nom de l'installation"?: string | null
          "Voie-rue"?: string | null
          Garder?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      gmail_accounts: {
        Row: {
          id: string
          employee_id: string | null
          access_token: string
          refresh_token: string | null
          expires_at: string | null
          created_at: string | null
          gmail_email: string | null
        }
        Insert: {
          id?: string
          employee_id?: string | null
          access_token: string
          refresh_token?: string | null
          expires_at?: string | null
          created_at?: string | null
          gmail_email?: string | null
        }
        Update: {
          id?: string
          employee_id?: string | null
          access_token?: string
          refresh_token?: string | null
          expires_at?: string | null
          created_at?: string | null
          gmail_email?: string | null
        }
        Relationships: []
      }
      hydromatch_inscriptions: {
        Row: {
          id: string
          created_at: string | null
          club_nom: string
          affiliation: string | null
          district: string | null
          ref_nom: string | null
          ref_email: string | null
          ref_tel: string | null
          maire_nom: string | null
          maire_tel: string | null
          photo_url: string | null
          type_inscription: string | null
          maire_email: string | null
          status: string | null
          notes: string | null
          adresse: string | null
        }
        Insert: {
          id?: string
          created_at?: string | null
          club_nom: string
          affiliation?: string | null
          district?: string | null
          ref_nom?: string | null
          ref_email?: string | null
          ref_tel?: string | null
          maire_nom?: string | null
          maire_tel?: string | null
          photo_url?: string | null
          type_inscription?: string | null
          maire_email?: string | null
          status?: string | null
          notes?: string | null
          adresse?: string | null
        }
        Update: {
          id?: string
          created_at?: string | null
          club_nom?: string
          affiliation?: string | null
          district?: string | null
          ref_nom?: string | null
          ref_email?: string | null
          ref_tel?: string | null
          maire_nom?: string | null
          maire_tel?: string | null
          photo_url?: string | null
          type_inscription?: string | null
          maire_email?: string | null
          status?: string | null
          notes?: string | null
          adresse?: string | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          event_id: string
          provider_id: string
          file_id: string
          file_name: string
          file_url: string
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          provider_id: string
          file_id: string
          file_name: string
          file_url: string
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          provider_id?: string
          file_id?: string
          file_name?: string
          file_url?: string
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lists: {
        Row: {
          id: string
          board_id: string | null
          title: string
          position: number
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          board_id?: string | null
          title: string
          position?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          board_id?: string | null
          title?: string
          position?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      message_archives: {
        Row: {
          user_id: string
          event_id: string
          archived_at: string
        }
        Insert: {
          user_id: string
          event_id: string
          archived_at?: string
        }
        Update: {
          user_id?: string
          event_id?: string
          archived_at?: string
        }
        Relationships: []
      }
      message_mailbox: {
        Row: {
          user_id: string
          event_id: string
          last_comment_id: string | null
          last_message_at: string
          last_message_preview: string | null
          last_author_id: string | null
          unread_count: number
          archived: boolean
          pinned: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          event_id: string
          last_comment_id?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          last_author_id?: string | null
          unread_count?: number
          archived?: boolean
          pinned?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          event_id?: string
          last_comment_id?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          last_author_id?: string | null
          unread_count?: number
          archived?: boolean
          pinned?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      monthly_expense_notifications: {
        Row: {
          id: string
          user_id: string
          month: string
          notified_at: string
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          month: string
          notified_at?: string
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          month?: string
          notified_at?: string
          created_at?: string | null
        }
        Relationships: []
      }
      notification_logs: {
        Row: {
          id: number
          sent_at: string | null
          user_email: string | null
          subject: string | null
          status: string | null
          raw_response: Json | null
        }
        Insert: {
          id?: number
          sent_at?: string | null
          user_email?: string | null
          subject?: string | null
          status?: string | null
          raw_response?: Json | null
        }
        Update: {
          id?: number
          sent_at?: string | null
          user_email?: string | null
          subject?: string | null
          status?: string | null
          raw_response?: Json | null
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          id: string
          type: string
          recipient: string
          event_id: string | null
          comment_id: string | null
          created_at: string
          dedupe_key: string
        }
        Insert: {
          id?: string
          type: string
          recipient: string
          event_id?: string | null
          comment_id?: string | null
          created_at?: string
          dedupe_key: string
        }
        Update: {
          id?: string
          type?: string
          recipient?: string
          event_id?: string | null
          comment_id?: string | null
          created_at?: string
          dedupe_key?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string | null
          type: Database["public"]["Enums"]["notification_type"]
          title: string
          message: string
          data: Json | null
          read: boolean | null
          created_at: string | null
          user_email: string | null
          user_name: string | null
          status: string | null
          event_id: string | null
          payload: Json | null
          is_deleted: boolean
          push_sent_at: string | null
          push_attempts: number | null
          push_last_status: string | null
          push_last_error: string | null
          push_enqueued_at: string | null
          actor_name: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          type: Database["public"]["Enums"]["notification_type"]
          title: string
          message?: string
          data?: Json | null
          read?: boolean | null
          created_at?: string | null
          user_email?: string | null
          user_name?: string | null
          status?: string | null
          event_id?: string | null
          payload?: Json | null
          is_deleted?: boolean
          push_sent_at?: string | null
          push_attempts?: number | null
          push_last_status?: string | null
          push_last_error?: string | null
          push_enqueued_at?: string | null
          actor_name?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          title?: string
          message?: string
          data?: Json | null
          read?: boolean | null
          created_at?: string | null
          user_email?: string | null
          user_name?: string | null
          status?: string | null
          event_id?: string | null
          payload?: Json | null
          is_deleted?: boolean
          push_sent_at?: string | null
          push_attempts?: number | null
          push_last_status?: string | null
          push_last_error?: string | null
          push_enqueued_at?: string | null
          actor_name?: string | null
        }
        Relationships: []
      }
      organisations: {
        Row: {
          id: string
          name: string
          slug: string
          logo_url: string | null
          primary_color: string | null
          created_at: string | null
          color: string | null
          bg_color: string | null
          show_sponsors: boolean | null
          sponsors: Json | null
          nb_licencies: number | null
          is_active: boolean | null
          structure_type: string | null
          parent_organisation_id: string | null
          specialties: Json | null
          specialty: string | null
          zone_ligue: boolean | null
          zone_all_districts: boolean | null
          zone_district_ids: Json | null
        }
        Insert: {
          id?: string
          name: string
          slug: string
          logo_url?: string | null
          primary_color?: string | null
          created_at?: string | null
          color?: string | null
          bg_color?: string | null
          show_sponsors?: boolean | null
          sponsors?: Json | null
          nb_licencies?: number | null
          is_active?: boolean | null
          structure_type?: string | null
          parent_organisation_id?: string | null
          specialties?: Json | null
          specialty?: string | null
          zone_ligue?: boolean | null
          zone_all_districts?: boolean | null
          zone_district_ids?: Json | null
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          logo_url?: string | null
          primary_color?: string | null
          created_at?: string | null
          color?: string | null
          bg_color?: string | null
          show_sponsors?: boolean | null
          sponsors?: Json | null
          nb_licencies?: number | null
          is_active?: boolean | null
          structure_type?: string | null
          parent_organisation_id?: string | null
          specialties?: Json | null
          specialty?: string | null
          zone_ligue?: boolean | null
          zone_all_districts?: boolean | null
          zone_district_ids?: Json | null
        }
        Relationships: []
      }
      profile_specialties: {
        Row: {
          user_id: string
          specialty_id: string
          created_at: string
        }
        Insert: {
          user_id: string
          specialty_id: string
          created_at?: string
        }
        Update: {
          user_id?: string
          specialty_id?: string
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          first_name: string | null
          last_name: string | null
          email: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          created_at: string | null
          updated_at: string | null
          sector: Database["public"]["Enums"]["sector_type"] | null
          avatar_url: string | null
          default_calendar_view: string | null
          theme: string | null
          home_address: string | null
          license_plate: string | null
          home_coordinates: Json | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          has_company_car: boolean | null
          has_ged_access: boolean | null
          organisation_id: string | null
          notify_email: boolean
          notify_push: boolean
        }
        Insert: {
          id: string
          first_name?: string | null
          last_name?: string | null
          email?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          created_at?: string | null
          updated_at?: string | null
          sector?: Database["public"]["Enums"]["sector_type"] | null
          avatar_url?: string | null
          default_calendar_view?: string | null
          theme?: string | null
          home_address?: string | null
          license_plate?: string | null
          home_coordinates?: Json | null
          employment_type?: Database["public"]["Enums"]["employment_type"] | null
          has_company_car?: boolean | null
          has_ged_access?: boolean | null
          organisation_id?: string | null
          notify_email?: boolean
          notify_push?: boolean
        }
        Update: {
          id?: string
          first_name?: string | null
          last_name?: string | null
          email?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          created_at?: string | null
          updated_at?: string | null
          sector?: Database["public"]["Enums"]["sector_type"] | null
          avatar_url?: string | null
          default_calendar_view?: string | null
          theme?: string | null
          home_address?: string | null
          license_plate?: string | null
          home_coordinates?: Json | null
          employment_type?: Database["public"]["Enums"]["employment_type"] | null
          has_company_car?: boolean | null
          has_ged_access?: boolean | null
          organisation_id?: string | null
          notify_email?: boolean
          notify_push?: boolean
        }
        Relationships: []
      }
      profiles_quiz: {
        Row: {
          id: string
          first_name: string | null
          last_name: string | null
          email: string | null
          phone: string | null
          avatar_url: string | null
          quiz_role: string | null
          organisation_id: string | null
          created_at: string | null
          updated_at: string | null
          access_starts_at: string | null
          access_ends_at: string | null
          access_revoked_at: string | null
          invited_by: string | null
          invited_at: string | null
        }
        Insert: {
          id: string
          first_name?: string | null
          last_name?: string | null
          email?: string | null
          phone?: string | null
          avatar_url?: string | null
          quiz_role?: string | null
          organisation_id?: string | null
          created_at?: string | null
          updated_at?: string | null
          access_starts_at?: string | null
          access_ends_at?: string | null
          access_revoked_at?: string | null
          invited_by?: string | null
          invited_at?: string | null
        }
        Update: {
          id?: string
          first_name?: string | null
          last_name?: string | null
          email?: string | null
          phone?: string | null
          avatar_url?: string | null
          quiz_role?: string | null
          organisation_id?: string | null
          created_at?: string | null
          updated_at?: string | null
          access_starts_at?: string | null
          access_ends_at?: string | null
          access_revoked_at?: string | null
          invited_by?: string | null
          invited_at?: string | null
        }
        Relationships: []
      }
      push_outbox: {
        Row: {
          id: number
          user_id: string
          title: string
          body: string
          data: Json
          created_at: string
          dispatched_at: string | null
          last_status: number | null
          last_error: string | null
          notification_id: string | null
          type: string | null
          event_id: string | null
          card_id: string | null
          comment_id: string | null
          dedupe_key: string | null
          processing_at: string | null
        }
        Insert: {
          id?: number
          user_id: string
          title: string
          body: string
          data?: Json
          created_at?: string
          dispatched_at?: string | null
          last_status?: number | null
          last_error?: string | null
          notification_id?: string | null
          type?: string | null
          event_id?: string | null
          card_id?: string | null
          comment_id?: string | null
          dedupe_key?: string | null
          processing_at?: string | null
        }
        Update: {
          id?: number
          user_id?: string
          title?: string
          body?: string
          data?: Json
          created_at?: string
          dispatched_at?: string | null
          last_status?: number | null
          last_error?: string | null
          notification_id?: string | null
          type?: string | null
          event_id?: string | null
          card_id?: string | null
          comment_id?: string | null
          dedupe_key?: string | null
          processing_at?: string | null
        }
        Relationships: []
      }
      push_queue: {
        Row: {
          id: number
          notification_id: string
          dispatched_at: string | null
          last_status: string | null
          last_error: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          notification_id: string
          dispatched_at?: string | null
          last_status?: string | null
          last_error?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          notification_id?: string
          dispatched_at?: string | null
          last_status?: string | null
          last_error?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      quiz_activation_tokens: {
        Row: {
          id: string
          user_id: string | null
          token: string
          expires_at: string
          used: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          token: string
          expires_at: string
          used?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          token?: string
          expires_at?: string
          used?: boolean | null
          created_at?: string | null
        }
        Relationships: []
      }
      quiz_adherent_requests: {
        Row: {
          id: string
          organisation_id: string
          first_name: string
          last_name: string
          email: string
          phone: string | null
          status: string
          rejection_reason: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
          account_email: string | null
          motivation: string | null
          declared_organisation_id: string | null
          specialty: string | null
        }
        Insert: {
          id?: string
          organisation_id: string
          first_name: string
          last_name: string
          email: string
          phone?: string | null
          status?: string
          rejection_reason?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          account_email?: string | null
          motivation?: string | null
          declared_organisation_id?: string | null
          specialty?: string | null
        }
        Update: {
          id?: string
          organisation_id?: string
          first_name?: string
          last_name?: string
          email?: string
          phone?: string | null
          status?: string
          rejection_reason?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          account_email?: string | null
          motivation?: string | null
          declared_organisation_id?: string | null
          specialty?: string | null
        }
        Relationships: []
      }
      quiz_affiliation_requests: {
        Row: {
          id: string
          profile_id: string
          organisation_id: string
          message: string | null
          status: string
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          organisation_id: string
          message?: string | null
          status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          organisation_id?: string
          message?: string | null
          status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      quiz_announcement_recipients: {
        Row: {
          id: string
          announcement_id: string
          profile_id: string | null
          email: string
          resend_message_id: string | null
          sent_at: string
          delivered_at: string | null
          opened_at: string | null
          open_count: number
        }
        Insert: {
          id?: string
          announcement_id: string
          profile_id?: string | null
          email: string
          resend_message_id?: string | null
          sent_at?: string
          delivered_at?: string | null
          opened_at?: string | null
          open_count?: number
        }
        Update: {
          id?: string
          announcement_id?: string
          profile_id?: string | null
          email?: string
          resend_message_id?: string | null
          sent_at?: string
          delivered_at?: string | null
          opened_at?: string | null
          open_count?: number
        }
        Relationships: []
      }
      quiz_announcements: {
        Row: {
          id: string
          subject: string
          body: string
          audience: string
          recipient_count: number
          sent_by: string
          sent_at: string
        }
        Insert: {
          id?: string
          subject: string
          body: string
          audience: string
          recipient_count?: number
          sent_by: string
          sent_at?: string
        }
        Update: {
          id?: string
          subject?: string
          body?: string
          audience?: string
          recipient_count?: number
          sent_by?: string
          sent_at?: string
        }
        Relationships: []
      }
      quiz_annuaire_contact_groups: {
        Row: {
          id: string
          contact_id: string
          group_id: string
        }
        Insert: {
          id?: string
          contact_id: string
          group_id: string
        }
        Update: {
          id?: string
          contact_id?: string
          group_id?: string
        }
        Relationships: []
      }
      quiz_annuaire_contacts: {
        Row: {
          id: string
          organisation_id: string
          name: string
          email: string | null
          phone: string | null
          created_at: string
          updated_at: string
          club: string | null
          club_address: string | null
        }
        Insert: {
          id?: string
          organisation_id: string
          name: string
          email?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
          club?: string | null
          club_address?: string | null
        }
        Update: {
          id?: string
          organisation_id?: string
          name?: string
          email?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
          club?: string | null
          club_address?: string | null
        }
        Relationships: []
      }
      quiz_annuaire_groups: {
        Row: {
          id: string
          organisation_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          name?: string
          created_at?: string
        }
        Relationships: []
      }
      quiz_annuaire_share_groups: {
        Row: {
          id: string
          share_id: string
          group_id: string | null
          group_name: string
        }
        Insert: {
          id?: string
          share_id: string
          group_id?: string | null
          group_name: string
        }
        Update: {
          id?: string
          share_id?: string
          group_id?: string | null
          group_name?: string
        }
        Relationships: []
      }
      quiz_annuaire_shares: {
        Row: {
          id: string
          organisation_id: string
          created_by: string
          message: string | null
          links: Json | null
          documents: Json | null
          channel_email: boolean
          channel_whatsapp: boolean
          email_attempted: number
          whatsapp_sent: number
          whatsapp_failed: number
          created_at: string
          subject: string | null
        }
        Insert: {
          id?: string
          organisation_id: string
          created_by: string
          message?: string | null
          links?: Json | null
          documents?: Json | null
          channel_email?: boolean
          channel_whatsapp?: boolean
          email_attempted?: number
          whatsapp_sent?: number
          whatsapp_failed?: number
          created_at?: string
          subject?: string | null
        }
        Update: {
          id?: string
          organisation_id?: string
          created_by?: string
          message?: string | null
          links?: Json | null
          documents?: Json | null
          channel_email?: boolean
          channel_whatsapp?: boolean
          email_attempted?: number
          whatsapp_sent?: number
          whatsapp_failed?: number
          created_at?: string
          subject?: string | null
        }
        Relationships: []
      }
      quiz_annuaire_signup_links: {
        Row: {
          id: string
          organisation_id: string
          group_id: string
          token: string
          allow_club: boolean
          allow_club_address: boolean
          submission_count: number
          last_submission_at: string | null
          created_by: string
          created_at: string
          revoked_at: string | null
        }
        Insert: {
          id?: string
          organisation_id: string
          group_id: string
          token: string
          allow_club?: boolean
          allow_club_address?: boolean
          submission_count?: number
          last_submission_at?: string | null
          created_by: string
          created_at?: string
          revoked_at?: string | null
        }
        Update: {
          id?: string
          organisation_id?: string
          group_id?: string
          token?: string
          allow_club?: boolean
          allow_club_address?: boolean
          submission_count?: number
          last_submission_at?: string | null
          created_by?: string
          created_at?: string
          revoked_at?: string | null
        }
        Relationships: []
      }
      quiz_answers: {
        Row: {
          id: string
          participant_id: string | null
          question_id: string | null
          selected_index: number
          created_at: string | null
          duration_seconds: number | null
          session_id: string | null
          is_correct: boolean | null
          answer_x: number | null
          answer_y: number | null
          answer_text: string | null
          word_slot: number | null
        }
        Insert: {
          id?: string
          participant_id?: string | null
          question_id?: string | null
          selected_index: number
          created_at?: string | null
          duration_seconds?: number | null
          session_id?: string | null
          is_correct?: boolean | null
          answer_x?: number | null
          answer_y?: number | null
          answer_text?: string | null
          word_slot?: number | null
        }
        Update: {
          id?: string
          participant_id?: string | null
          question_id?: string | null
          selected_index?: number
          created_at?: string | null
          duration_seconds?: number | null
          session_id?: string | null
          is_correct?: boolean | null
          answer_x?: number | null
          answer_y?: number | null
          answer_text?: string | null
          word_slot?: number | null
        }
        Relationships: []
      }
      quiz_library_media: {
        Row: {
          id: string
          organisation_id: string
          uploaded_by: string
          file_name: string
          file_url: string
          storage_path: string
          file_type: string
          file_size: number | null
          is_shared: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          uploaded_by: string
          file_name: string
          file_url: string
          storage_path: string
          file_type: string
          file_size?: number | null
          is_shared?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          uploaded_by?: string
          file_name?: string
          file_url?: string
          storage_path?: string
          file_type?: string
          file_size?: number | null
          is_shared?: boolean
          created_at?: string
        }
        Relationships: []
      }
      quiz_member_requests: {
        Row: {
          id: string
          organisation_id: string
          structure_name: string
          structure_type: string
          department: string | null
          nb_licencies: number | null
          contact_email: string
          contact_first_name: string | null
          contact_last_name: string | null
          contact_phone: string | null
          logo_url: string | null
          motivation: string | null
          status: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          rejection_reason: string | null
          created_at: string | null
          updated_at: string | null
          specialty: string | null
          zone_ligue: boolean | null
          zone_all_districts: boolean | null
          zone_district_ids: Json | null
        }
        Insert: {
          id?: string
          organisation_id: string
          structure_name: string
          structure_type: string
          department?: string | null
          nb_licencies?: number | null
          contact_email: string
          contact_first_name?: string | null
          contact_last_name?: string | null
          contact_phone?: string | null
          logo_url?: string | null
          motivation?: string | null
          status?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
          specialty?: string | null
          zone_ligue?: boolean | null
          zone_all_districts?: boolean | null
          zone_district_ids?: Json | null
        }
        Update: {
          id?: string
          organisation_id?: string
          structure_name?: string
          structure_type?: string
          department?: string | null
          nb_licencies?: number | null
          contact_email?: string
          contact_first_name?: string | null
          contact_last_name?: string | null
          contact_phone?: string | null
          logo_url?: string | null
          motivation?: string | null
          status?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
          specialty?: string | null
          zone_ligue?: boolean | null
          zone_all_districts?: boolean | null
          zone_district_ids?: Json | null
        }
        Relationships: []
      }
      quiz_notifications: {
        Row: {
          id: string
          recipient_id: string
          type: string
          title: string
          body: string | null
          link: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          recipient_id: string
          type: string
          title: string
          body?: string | null
          link?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          recipient_id?: string
          type?: string
          title?: string
          body?: string | null
          link?: string | null
          read_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      quiz_organizer_requests: {
        Row: {
          id: string
          structure_name: string
          structure_type: string
          department: string | null
          nb_licencies: number | null
          contact_email: string
          contact_first_name: string | null
          contact_last_name: string | null
          contact_phone: string | null
          logo_url: string | null
          motivation: string | null
          status: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          rejection_reason: string | null
          created_at: string | null
          updated_at: string | null
          account_email: string | null
          specialties: Json | null
        }
        Insert: {
          id?: string
          structure_name: string
          structure_type: string
          department?: string | null
          nb_licencies?: number | null
          contact_email: string
          contact_first_name?: string | null
          contact_last_name?: string | null
          contact_phone?: string | null
          logo_url?: string | null
          motivation?: string | null
          status?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
          account_email?: string | null
          specialties?: Json | null
        }
        Update: {
          id?: string
          structure_name?: string
          structure_type?: string
          department?: string | null
          nb_licencies?: number | null
          contact_email?: string
          contact_first_name?: string | null
          contact_last_name?: string | null
          contact_phone?: string | null
          logo_url?: string | null
          motivation?: string | null
          status?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
          account_email?: string | null
          specialties?: Json | null
        }
        Relationships: []
      }
      quiz_participants: {
        Row: {
          id: string
          session_id: string | null
          name: string
          score: number | null
          color: string | null
          phone: string | null
        }
        Insert: {
          id?: string
          session_id?: string | null
          name: string
          score?: number | null
          color?: string | null
          phone?: string | null
        }
        Update: {
          id?: string
          session_id?: string | null
          name?: string
          score?: number | null
          color?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      quiz_phone_verifications: {
        Row: {
          id: string
          session_id: string
          phone: string
          code: string
          attempts: number
          expires_at: string
          verified_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          phone: string
          code: string
          attempts?: number
          expires_at: string
          verified_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          phone?: string
          code?: string
          attempts?: number
          expires_at?: string
          verified_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      quiz_platform_ads: {
        Row: {
          id: string
          is_active: boolean | null
          host_media_url: string | null
          host_media_type: string | null
          host_storage_path: string | null
          host_layout: string | null
          player_media_url: string | null
          player_media_type: string | null
          player_storage_path: string | null
          updated_by: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          is_active?: boolean | null
          host_media_url?: string | null
          host_media_type?: string | null
          host_storage_path?: string | null
          host_layout?: string | null
          player_media_url?: string | null
          player_media_type?: string | null
          player_storage_path?: string | null
          updated_by?: string | null
          updated_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          is_active?: boolean | null
          host_media_url?: string | null
          host_media_type?: string | null
          host_storage_path?: string | null
          host_layout?: string | null
          player_media_url?: string | null
          player_media_type?: string | null
          player_storage_path?: string | null
          updated_by?: string | null
          updated_at?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      quiz_profile_affiliations: {
        Row: {
          id: string
          profile_id: string
          organisation_id: string
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          organisation_id: string
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          organisation_id?: string
          created_at?: string
        }
        Relationships: []
      }
      quiz_questions: {
        Row: {
          id: string
          quiz_id: string | null
          question_text: string
          options: Json
          correct_option: string | null
          last_scored_session: string | null
          created_at: string | null
          position: number
          time_limit: number | null
          points: number | null
          media_url: string | null
          media_type: string | null
          media_preview_time: number | null
          media_source: string | null
          illustration_url: string | null
          question_type: string | null
          target_x: number | null
          target_y: number | null
          word_cloud_max_words: number | null
          poll_allow_multiple: boolean | null
          allow_multiple_correct: boolean | null
          correct_options: Json | null
          partial_credit: boolean | null
          explanation: string | null
        }
        Insert: {
          id?: string
          quiz_id?: string | null
          question_text: string
          options: Json
          correct_option?: string | null
          last_scored_session?: string | null
          created_at?: string | null
          position?: number
          time_limit?: number | null
          points?: number | null
          media_url?: string | null
          media_type?: string | null
          media_preview_time?: number | null
          media_source?: string | null
          illustration_url?: string | null
          question_type?: string | null
          target_x?: number | null
          target_y?: number | null
          word_cloud_max_words?: number | null
          poll_allow_multiple?: boolean | null
          allow_multiple_correct?: boolean | null
          correct_options?: Json | null
          partial_credit?: boolean | null
          explanation?: string | null
        }
        Update: {
          id?: string
          quiz_id?: string | null
          question_text?: string
          options?: Json
          correct_option?: string | null
          last_scored_session?: string | null
          created_at?: string | null
          position?: number
          time_limit?: number | null
          points?: number | null
          media_url?: string | null
          media_type?: string | null
          media_preview_time?: number | null
          media_source?: string | null
          illustration_url?: string | null
          question_type?: string | null
          target_x?: number | null
          target_y?: number | null
          word_cloud_max_words?: number | null
          poll_allow_multiple?: boolean | null
          allow_multiple_correct?: boolean | null
          correct_options?: Json | null
          partial_credit?: boolean | null
          explanation?: string | null
        }
        Relationships: []
      }
      quiz_report_shares: {
        Row: {
          id: string
          session_id: string
          token: string
          created_by: string
          created_at: string
          revoked_at: string | null
        }
        Insert: {
          id?: string
          session_id: string
          token: string
          created_by: string
          created_at?: string
          revoked_at?: string | null
        }
        Update: {
          id?: string
          session_id?: string
          token?: string
          created_by?: string
          created_at?: string
          revoked_at?: string | null
        }
        Relationships: []
      }
      quiz_sessions: {
        Row: {
          id: string
          quiz_id: string | null
          code: string
          current_question_id: string | null
          is_active: boolean | null
          created_at: string | null
          host_id: string | null
          status: string | null
          current_question_index: number | null
          answer_revealed: boolean | null
          question_started_at: string | null
          mode: string | null
          starts_at: string | null
          ends_at: string | null
          whatsapp_group_url: string | null
        }
        Insert: {
          id?: string
          quiz_id?: string | null
          code: string
          current_question_id?: string | null
          is_active?: boolean | null
          created_at?: string | null
          host_id?: string | null
          status?: string | null
          current_question_index?: number | null
          answer_revealed?: boolean | null
          question_started_at?: string | null
          mode?: string | null
          starts_at?: string | null
          ends_at?: string | null
          whatsapp_group_url?: string | null
        }
        Update: {
          id?: string
          quiz_id?: string | null
          code?: string
          current_question_id?: string | null
          is_active?: boolean | null
          created_at?: string | null
          host_id?: string | null
          status?: string | null
          current_question_index?: number | null
          answer_revealed?: boolean | null
          question_started_at?: string | null
          mode?: string | null
          starts_at?: string | null
          ends_at?: string | null
          whatsapp_group_url?: string | null
        }
        Relationships: []
      }
      quiz_shares: {
        Row: {
          id: string
          quiz_id: string
          shared_by: string
          profile_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          quiz_id: string
          shared_by: string
          profile_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          quiz_id?: string
          shared_by?: string
          profile_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      quizzes: {
        Row: {
          id: string
          title: string
          background_url: string | null
          question_duration: number | null
          created_by: string | null
          created_at: string | null
          logo_url: string | null
          primary_color: string | null
          button_color: string | null
          button_text_color: string | null
          brand_title: string | null
          category: string | null
          color: string | null
          organisation_id: string | null
          updated_at: string | null
          reveal_who_answered: boolean | null
          remote_phone_verification: boolean | null
        }
        Insert: {
          id?: string
          title: string
          background_url?: string | null
          question_duration?: number | null
          created_by?: string | null
          created_at?: string | null
          logo_url?: string | null
          primary_color?: string | null
          button_color?: string | null
          button_text_color?: string | null
          brand_title?: string | null
          category?: string | null
          color?: string | null
          organisation_id?: string | null
          updated_at?: string | null
          reveal_who_answered?: boolean | null
          remote_phone_verification?: boolean | null
        }
        Update: {
          id?: string
          title?: string
          background_url?: string | null
          question_duration?: number | null
          created_by?: string | null
          created_at?: string | null
          logo_url?: string | null
          primary_color?: string | null
          button_color?: string | null
          button_text_color?: string | null
          brand_title?: string | null
          category?: string | null
          color?: string | null
          organisation_id?: string | null
          updated_at?: string | null
          reveal_who_answered?: boolean | null
          remote_phone_verification?: boolean | null
        }
        Relationships: []
      }
      signature_applications: {
        Row: {
          id: string
          employee_id: string
          provider: string
          applied_by: string | null
          applied_at: string
          status: string
        }
        Insert: {
          id?: string
          employee_id: string
          provider: string
          applied_by?: string | null
          applied_at?: string
          status?: string
        }
        Update: {
          id?: string
          employee_id?: string
          provider?: string
          applied_by?: string | null
          applied_at?: string
          status?: string
        }
        Relationships: []
      }
      signature_cache: {
        Row: {
          employee_id: string
          html: string | null
          updated_at: string | null
        }
        Insert: {
          employee_id: string
          html?: string | null
          updated_at?: string | null
        }
        Update: {
          employee_id?: string
          html?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      signature_designs: {
        Row: {
          id: string
          name: string
          image_url: string
          is_active: boolean | null
          created_at: string | null
          position: string | null
          start_at: string | null
          end_at: string | null
          placement: string | null
          display_order: number | null
        }
        Insert: {
          id?: string
          name: string
          image_url: string
          is_active?: boolean | null
          created_at?: string | null
          position?: string | null
          start_at?: string | null
          end_at?: string | null
          placement?: string | null
          display_order?: number | null
        }
        Update: {
          id?: string
          name?: string
          image_url?: string
          is_active?: boolean | null
          created_at?: string | null
          position?: string | null
          start_at?: string | null
          end_at?: string | null
          placement?: string | null
          display_order?: number | null
        }
        Relationships: []
      }
      signature_global: {
        Row: {
          id: string
          banner_image_url: string | null
          alert_message: string | null
          updated_at: string | null
          base_html: string | null
          show_banner: boolean | null
          banner_color: string | null
          banner_padding: number | null
          name_color: string | null
          text_color: string | null
          link_color: string | null
          banner_text: string | null
          banner_link: string | null
          footer_image_url: string | null
        }
        Insert: {
          id?: string
          banner_image_url?: string | null
          alert_message?: string | null
          updated_at?: string | null
          base_html?: string | null
          show_banner?: boolean | null
          banner_color?: string | null
          banner_padding?: number | null
          name_color?: string | null
          text_color?: string | null
          link_color?: string | null
          banner_text?: string | null
          banner_link?: string | null
          footer_image_url?: string | null
        }
        Update: {
          id?: string
          banner_image_url?: string | null
          alert_message?: string | null
          updated_at?: string | null
          base_html?: string | null
          show_banner?: boolean | null
          banner_color?: string | null
          banner_padding?: number | null
          name_color?: string | null
          text_color?: string | null
          link_color?: string | null
          banner_text?: string | null
          banner_link?: string | null
          footer_image_url?: string | null
        }
        Relationships: []
      }
      signature_profiles: {
        Row: {
          employee_id: string
          first_name: string
          last_name: string
          job_title: string | null
          phone: string | null
          mobile: string | null
          updated_at: string
        }
        Insert: {
          employee_id: string
          first_name: string
          last_name: string
          job_title?: string | null
          phone?: string | null
          mobile?: string | null
          updated_at?: string
        }
        Update: {
          employee_id?: string
          first_name?: string
          last_name?: string
          job_title?: string | null
          phone?: string | null
          mobile?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      specialties: {
        Row: {
          id: string
          label: string
          slug: string
          domain: string
          created_at: string
        }
        Insert: {
          id?: string
          label: string
          slug: string
          domain: string
          created_at?: string
        }
        Update: {
          id?: string
          label?: string
          slug?: string
          domain?: string
          created_at?: string
        }
        Relationships: []
      }
      specialty_allowed_event_types: {
        Row: {
          specialty_id: string
          event_type: Database["public"]["Enums"]["event_type"]
        }
        Insert: {
          specialty_id: string
          event_type: Database["public"]["Enums"]["event_type"]
        }
        Update: {
          specialty_id?: string
          event_type?: Database["public"]["Enums"]["event_type"]
        }
        Relationships: []
      }
      specialty_event_types: {
        Row: {
          specialty_slug: string
          event_type: Database["public"]["Enums"]["event_type"]
        }
        Insert: {
          specialty_slug: string
          event_type: Database["public"]["Enums"]["event_type"]
        }
        Update: {
          specialty_slug?: string
          event_type?: Database["public"]["Enums"]["event_type"]
        }
        Relationships: []
      }
      travel_distances: {
        Row: {
          id: string
          event_id: string
          user_id: string
          from_address: string
          to_address: string
          distance_km: number
          duration_minutes: number | null
          calculated_at: string
          api_response: Json | null
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          from_address: string
          to_address: string
          distance_km: number
          duration_minutes?: number | null
          calculated_at?: string
          api_response?: Json | null
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          from_address?: string
          to_address?: string
          distance_km?: number
          duration_minutes?: number | null
          calculated_at?: string
          api_response?: Json | null
        }
        Relationships: []
      }
      user_board_orders: {
        Row: {
          user_id: string
          scope: string
          board_id: string
          position: number
        }
        Insert: {
          user_id: string
          scope?: string
          board_id: string
          position?: number
        }
        Update: {
          user_id?: string
          scope?: string
          board_id?: string
          position?: number
        }
        Relationships: []
      }
      user_list_orders: {
        Row: {
          user_id: string
          board_id: string
          list_id: string
          position: number
        }
        Insert: {
          user_id: string
          board_id: string
          list_id: string
          position?: number
        }
        Update: {
          user_id?: string
          board_id?: string
          list_id?: string
          position?: number
        }
        Relationships: []
      }
      user_message_state: {
        Row: {
          user_id: string
          message_id: string
          deleted: boolean | null
          read: boolean | null
          archived: boolean | null
          updated_at: string | null
        }
        Insert: {
          user_id: string
          message_id: string
          deleted?: boolean | null
          read?: boolean | null
          archived?: boolean | null
          updated_at?: string | null
        }
        Update: {
          user_id?: string
          message_id?: string
          deleted?: boolean | null
          read?: boolean | null
          archived?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      weekend_event_matches: {
        Row: {
          id: string
          event_id: string
          competition: string | null
          pool: string | null
          home_team: string | null
          away_team: string | null
          address: string | null
          city: string | null
          postal_code: string | null
          kickoff_at: string | null
          technician_id: string | null
          notes: string | null
          created_at: string
          created_by: string
          updated_at: string
          technician_response: string | null
          media_choice: string | null
          show_in_calendar: boolean | null
        }
        Insert: {
          id?: string
          event_id: string
          competition?: string | null
          pool?: string | null
          home_team?: string | null
          away_team?: string | null
          address?: string | null
          city?: string | null
          postal_code?: string | null
          kickoff_at?: string | null
          technician_id?: string | null
          notes?: string | null
          created_at?: string
          created_by?: string
          updated_at?: string
          technician_response?: string | null
          media_choice?: string | null
          show_in_calendar?: boolean | null
        }
        Update: {
          id?: string
          event_id?: string
          competition?: string | null
          pool?: string | null
          home_team?: string | null
          away_team?: string | null
          address?: string | null
          city?: string | null
          postal_code?: string | null
          kickoff_at?: string | null
          technician_id?: string | null
          notes?: string | null
          created_at?: string
          created_by?: string
          updated_at?: string
          technician_response?: string | null
          media_choice?: string | null
          show_in_calendar?: boolean | null
        }
        Relationships: []
      }
      weekend_matches: {
        Row: {
          id: string
          event_id: string
          title: string
          competition: string | null
          pool: string | null
          kickoff_at: string | null
          address: string | null
          city: string | null
          postal_code: string | null
          technician_id: string | null
          checked: boolean
          created_at: string
          technician_name: string | null
        }
        Insert: {
          id?: string
          event_id: string
          title: string
          competition?: string | null
          pool?: string | null
          kickoff_at?: string | null
          address?: string | null
          city?: string | null
          postal_code?: string | null
          technician_id?: string | null
          checked?: boolean
          created_at?: string
          technician_name?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          title?: string
          competition?: string | null
          pool?: string | null
          kickoff_at?: string | null
          address?: string | null
          city?: string | null
          postal_code?: string | null
          technician_id?: string | null
          checked?: boolean
          created_at?: string
          technician_name?: string | null
        }
        Relationships: []
      }
      whatsapp_contacts: {
        Row: {
          id: string
          first_name: string
          last_name: string
          phone: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          first_name: string
          last_name: string
          phone: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          first_name?: string
          last_name?: string
          phone?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      allowed_event_types_for_user: {
        Row: {
          user_id: string | null
          event_type: Database["public"]["Enums"]["event_type"] | null
        }
        Relationships: []
      }
      assignable_card_members: {
        Row: {
          board_id: string | null
          id: string | null
          first_name: string | null
          last_name: string | null
          email: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          created_at: string | null
          updated_at: string | null
          sector: Database["public"]["Enums"]["sector_type"] | null
          avatar_url: string | null
          default_calendar_view: string | null
          theme: string | null
          home_address: string | null
          license_plate: string | null
          home_coordinates: Json | null
        }
        Relationships: []
      }
      board_member_profiles: {
        Row: {
          board_id: string | null
          user_id: string | null
          first_name: string | null
          last_name: string | null
          avatar_url: string | null
        }
        Relationships: []
      }
      board_visible_members: {
        Row: {
          board_id: string | null
          user_id: string | null
        }
        Relationships: []
      }
      boards_owned_by_me: {
        Row: {
          id: string | null
          event_id: string | null
          title: string | null
          description: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
        }
        Relationships: []
      }
      boards_shared_with_me: {
        Row: {
          id: string | null
          event_id: string | null
          title: string | null
          description: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
        }
        Relationships: []
      }
      card_member_profiles: {
        Row: {
          card_id: string | null
          user_id: string | null
          first_name: string | null
          last_name: string | null
          avatar_url: string | null
          membership_id: string | null
          assigned_by: string | null
          assigned_at: string | null
          email: string | null
        }
        Relationships: []
      }
      card_stats: {
        Row: {
          card_id: string | null
          checklist_count: number | null
          checklist_done: number | null
        }
        Relationships: []
      }
      coverage_requests_with_event: {
        Row: {
          id: string | null
          event_id: string | null
          requester_id: string | null
          status: Database["public"]["Enums"]["coverage_request_status"] | null
          details: string | null
          approved_by: string | null
          approved_at: string | null
          created_at: string | null
          updated_at: string | null
          assigned_technician_id: string | null
          assigned_technician_name: string | null
          assigned_technician_email: string | null
          assigned_technician_phone: string | null
          coverage_symbol: string | null
          comment: string | null
          attachments: Json | null
          active: boolean | null
          technician_response: string | null
          technician_response_date: string | null
          technician_response_notes: string | null
          technician_id: string | null
          responded_at: string | null
          event_title: string | null
          event_location: string | null
          event_start_date: string | null
          event_end_date: string | null
          organizer_id: string | null
          event_status: Database["public"]["Enums"]["event_status"] | null
          description: string | null
          event_created_at: string | null
          event_updated_at: string | null
        }
        Relationships: []
      }
      event_technician_info: {
        Row: {
          event_id: string | null
          technician_id: string | null
          technician_name: string | null
          technician_email: string | null
          technician_phone: string | null
          status: Database["public"]["Enums"]["coverage_request_status"] | null
          coverage_symbol: string | null
          details: string | null
          comment: string | null
          created_at: string | null
          updated_at: string | null
          approved_at: string | null
          responded_at: string | null
          technician_response: string | null
          technician_response_date: string | null
          technician_response_notes: string | null
        }
        Relationships: []
      }
      events_calendar: {
        Row: {
          id: string | null
          title: string | null
          description: string | null
          location: string | null
          event_type: Database["public"]["Enums"]["event_type"] | null
          organizer_id: string | null
          requires_coverage: boolean | null
          start_date: string | null
          end_date: string | null
          coalesce_end_or_start: string | null
          visibility: string | null
          show_in_calendar: boolean | null
          calendar_card_id: string | null
        }
        Relationships: []
      }
      events_calendar_for_user: {
        Row: {
          id: string | null
          title: string | null
          description: string | null
          start_date: string | null
          end_date: string | null
          location: string | null
          organizer_id: string | null
          status: Database["public"]["Enums"]["event_status"] | null
          requires_coverage: boolean | null
          created_at: string | null
          updated_at: string | null
          event_type: Database["public"]["Enums"]["event_type"] | null
          visibility: string | null
          board_id: string | null
          calendar_card_id: string | null
          type: string | null
          created_by: string | null
          show_in_calendar: boolean | null
          event_address: string | null
          event_coordinates: Json | null
          organizer_message: string | null
          updated_by: string | null
          coverage_status: Database["public"]["Enums"]["coverage_request_status"] | null
          coverage_assigned_technician_id: string | null
          coverage_technician_response: string | null
          coverage_updated_at: string | null
          coverage_symbol: string | null
          coalesce_end_or_start: string | null
        }
        Relationships: []
      }
      events_calendar_view: {
        Row: {
          id: string | null
          title: string | null
          description: string | null
          start_date: string | null
          end_date: string | null
          location: string | null
          organizer_id: string | null
          status: Database["public"]["Enums"]["event_status"] | null
          requires_coverage: boolean | null
          created_at: string | null
          updated_at: string | null
          event_type: Database["public"]["Enums"]["event_type"] | null
          visibility: string | null
          board_id: string | null
          calendar_card_id: string | null
          type: string | null
          created_by: string | null
          show_in_calendar: boolean | null
          event_address: string | null
          event_coordinates: Json | null
          organizer_message: string | null
          updated_by: string | null
          committee_status: string | null
          committee_director_id: string | null
        }
        Relationships: []
      }
      events_calendar_with_latest_coverage: {
        Row: {
          id: string | null
          title: string | null
          description: string | null
          location: string | null
          event_type: Database["public"]["Enums"]["event_type"] | null
          type: string | null
          organizer_id: string | null
          created_by: string | null
          start_date: string | null
          end_date: string | null
          visibility: string | null
          show_in_calendar: boolean | null
          calendar_card_id: string | null
          event_address: string | null
          event_coordinates: Json | null
          requires_coverage: boolean | null
          coverage_status: Database["public"]["Enums"]["coverage_request_status"] | null
          coverage_assigned_technician_id: string | null
          coverage_technician_response: string | null
          coverage_updated_at: string | null
          coalesce_end_or_start: string | null
        }
        Relationships: []
      }
      expense_submissions_with_details: {
        Row: {
          id: string | null
          user_id: string | null
          event_id: string | null
          expense_ids: string[] | null
          total_amount: number | null
          status: string | null
          comments: string | null
          submitted_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_comments: string | null
          created_at: string | null
          updated_at: string | null
          expenses: Json | null
        }
        Relationships: []
      }
      message_mailbox_for_user: {
        Row: {
          event_id: string | null
          event_title: string | null
          last_message_preview: string | null
          last_message_at: string | null
          unread_count: number | null
          archived: boolean | null
        }
        Relationships: []
      }
      message_mailbox_v: {
        Row: {
          event_id: string | null
          event_title: string | null
          last_message_preview: string | null
          last_message_at: string | null
          unread_count: number | null
          archived: boolean | null
        }
        Relationships: []
      }
      organizers_by_event_type: {
        Row: {
          user_id: string | null
          email: string | null
          first_name: string | null
          last_name: string | null
          specialty_slug: string | null
        }
        Relationships: []
      }
      v_fixtures_from_raw: {
        Row: {
          id: string | null
          competition: string | null
          pool: string | null
          home_team: string | null
          away_team: string | null
          kickoff_at: string | null
          stadium: string | null
          address: string | null
          postal_code: string | null
          city: string | null
          created_at: string | null
        }
        Relationships: []
      }
      v_is_technician_salarie: {
        Row: {
          user_id: string | null
          is_salarie: boolean | null
        }
        Relationships: []
      }
      v_my_allowed_event_types: {
        Row: {
          event_type: Database["public"]["Enums"]["event_type"] | null
        }
        Relationships: []
      }
      v_user_technician_flavor: {
        Row: {
          user_id: string | null
          any_tech: boolean | null
          salarie: boolean | null
          benevole: boolean | null
          prestataire: boolean | null
          reseau: boolean | null
          primary_flavor: string | null
        }
        Relationships: []
      }
      v_user_technician_tabs: {
        Row: {
          user_id: string | null
          show_expenses_tab: boolean | null
          show_billing_tab: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      [key: string]: {
        Args: Record<string, unknown>
        Returns: unknown
      }
    }
    Enums: {
      card_visibility: "public" | "board" | "members" | "private"
      coverage_request_status: "pending" | "approved" | "rejected" | "denied" | "cancelled"
      employment_type: "employee" | "provider" | "volunteer"
      event_status: "pending" | "approved" | "rejected" | "completed"
      event_type: "arbitrage" | "technique" | "formation" | "communication" | "competitions" | "institutionnel" | "kanban" | "tirages_coupes" | "match_du_week_end" | "clubs" | "pem_pole_espoirs_mixte"
      invoice_status: "submitted" | "processing" | "approved" | "rejected" | "paid"
      label_color: "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "gray"
      note_member_role: "createur" | "destinataire" | "collaborateur"
      notification_type: "card_assigned" | "card_commented" | "card_mentioned" | "card_due_soon" | "board_shared" | "director_assignment" | "expense_submitted" | "account_request" | "coverage_request" | "coverage_request_created" | "coverage_approved" | "coverage_denied" | "coverage_assignment" | "coverage_rejected" | "event_deleted" | "event_mentioned" | "event_commented" | "account_request_approved" | "account_request_denied" | "assignment_created" | "assignment_updated" | "expense_approved" | "expense_rejected" | "coverage_accepted" | "coverage_accepted_admin" | "director_request" | "director_approved" | "director_denied" | "director_reassigned" | "director_invitation" | "director_accepted" | "director_declined" | "event_team_added" | "event_reminder"
      response_status: "accepted" | "rejected"
      sector_type: "arbitrage" | "technique" | "formation" | "communication" | "competitions"
      user_role: "user" | "technician" | "super_user" | "admin" | "organizer" | "comite_directeur_bad" | "comite_directeur"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<
  PublicTableNameOrOptions extends keyof PublicSchema["Tables"] | keyof PublicSchema["Views"]
> = PublicSchema["Tables"][PublicTableNameOrOptions extends keyof PublicSchema["Tables"] ? PublicTableNameOrOptions : never]["Row"] &
  (PublicTableNameOrOptions extends keyof PublicSchema["Views"] ? PublicSchema["Views"][PublicTableNameOrOptions]["Row"] : object)

export type TablesInsert<PublicTableNameOrOptions extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][PublicTableNameOrOptions]["Insert"]

export type TablesUpdate<PublicTableNameOrOptions extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][PublicTableNameOrOptions]["Update"]

export type Enums<PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][PublicEnumNameOrOptions]
