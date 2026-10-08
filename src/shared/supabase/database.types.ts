// Сгенерировано: `npx supabase gen types typescript --local` (+ prettier). Руками не править —
// сужение до доменных типов делает src/shared/api/types.ts.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_alerts: {
        Row: {
          key: string;
          last_sent_at: string;
          suppressed_count: number;
          updated_at: string;
        };
        Insert: {
          key: string;
          last_sent_at: string;
          suppressed_count?: number;
          updated_at?: string;
        };
        Update: {
          key?: string;
          last_sent_at?: string;
          suppressed_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      board_presence: {
        Row: {
          evening_id: string;
          seen_at: string;
          voice_at: string | null;
        };
        Insert: {
          evening_id: string;
          seen_at: string;
          voice_at?: string | null;
        };
        Update: {
          evening_id?: string;
          seen_at?: string;
          voice_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'board_presence_evening_id_fkey';
            columns: ['evening_id'];
            isOneToOne: true;
            referencedRelation: 'evenings';
            referencedColumns: ['id'];
          },
        ];
      };
      cron_heartbeat: {
        Row: {
          id: number;
          last_ok_at: string | null;
          last_run_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          last_ok_at?: string | null;
          last_run_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: number;
          last_ok_at?: string | null;
          last_run_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      evening_events: {
        Row: {
          at: string;
          client_id: string | null;
          created_by: string | null;
          evening_id: string;
          id: number;
          payload: NonNullable<Json>;
          type: string;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          at?: string;
          client_id?: string | null;
          created_by?: string | null;
          evening_id: string;
          id?: number;
          payload?: NonNullable<Json>;
          type: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          at?: string;
          client_id?: string | null;
          created_by?: string | null;
          evening_id?: string;
          id?: number;
          payload?: NonNullable<Json>;
          type?: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'evening_events_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evening_events_evening_id_fkey';
            columns: ['evening_id'];
            isOneToOne: false;
            referencedRelation: 'evenings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evening_events_voided_by_fkey';
            columns: ['voided_by'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
      evenings: {
        Row: {
          announce_posted_at: string | null;
          announce_snapshot: Json | null;
          banker_id: string | null;
          board_token: string;
          cancel_reason: string | null;
          created_at: string;
          created_by: string | null;
          finished_at: string | null;
          format: NonNullable<Json>;
          gameday_posted_at: string | null;
          id: string;
          is_training: boolean;
          location: string | null;
          note: string | null;
          results_posted_at: string | null;
          results_revision: number;
          scheduled_at: string;
          scoring: Json | null;
          settle_reopened_at: string | null;
          settled_at: string | null;
          slot_date: string | null;
          started_at: string | null;
          status: string;
          voting_closes_at: string | null;
          voting_posted_at: string | null;
          voting_reminder_posted_at: string | null;
        };
        Insert: {
          announce_posted_at?: string | null;
          announce_snapshot?: Json | null;
          banker_id?: string | null;
          board_token?: string;
          cancel_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          finished_at?: string | null;
          format: NonNullable<Json>;
          gameday_posted_at?: string | null;
          id?: string;
          is_training?: boolean;
          location?: string | null;
          note?: string | null;
          results_posted_at?: string | null;
          results_revision?: number;
          scheduled_at: string;
          scoring?: Json | null;
          settle_reopened_at?: string | null;
          settled_at?: string | null;
          slot_date?: string | null;
          started_at?: string | null;
          status?: string;
          voting_closes_at?: string | null;
          voting_posted_at?: string | null;
          voting_reminder_posted_at?: string | null;
        };
        Update: {
          announce_posted_at?: string | null;
          announce_snapshot?: Json | null;
          banker_id?: string | null;
          board_token?: string;
          cancel_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          finished_at?: string | null;
          format?: NonNullable<Json>;
          gameday_posted_at?: string | null;
          id?: string;
          is_training?: boolean;
          location?: string | null;
          note?: string | null;
          results_posted_at?: string | null;
          results_revision?: number;
          scheduled_at?: string;
          scoring?: Json | null;
          settle_reopened_at?: string | null;
          settled_at?: string | null;
          slot_date?: string | null;
          started_at?: string | null;
          status?: string;
          voting_closes_at?: string | null;
          voting_posted_at?: string | null;
          voting_reminder_posted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'evenings_banker_id_fkey';
            columns: ['banker_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'evenings_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
      formats: {
        Row: {
          config: NonNullable<Json>;
          created_at: string;
          id: string;
          is_archived: boolean;
          name: string;
        };
        Insert: {
          config: NonNullable<Json>;
          created_at?: string;
          id?: string;
          is_archived?: boolean;
          name: string;
        };
        Update: {
          config?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          is_archived?: boolean;
          name?: string;
        };
        Relationships: [];
      };
      players: {
        Row: {
          auth_user_id: string | null;
          created_at: string;
          display_name: string;
          id: string;
          is_active: boolean;
          is_admin: boolean;
          is_guest: boolean;
          is_spectator: boolean | null;
          photo_url: string | null;
          spoken_name: string | null;
          tg_id: number | null;
          username: string | null;
        };
        Insert: {
          auth_user_id?: string | null;
          created_at?: string;
          display_name: string;
          id?: string;
          is_active?: boolean;
          is_admin?: boolean;
          is_guest?: boolean;
          is_spectator?: boolean | null;
          photo_url?: string | null;
          spoken_name?: string | null;
          tg_id?: number | null;
          username?: string | null;
        };
        Update: {
          auth_user_id?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          is_active?: boolean;
          is_admin?: boolean;
          is_guest?: boolean;
          is_spectator?: boolean | null;
          photo_url?: string | null;
          spoken_name?: string | null;
          tg_id?: number | null;
          username?: string | null;
        };
        Relationships: [];
      };
      predictions: {
        Row: {
          evening_id: string;
          first_out_id: string | null;
          player_id: string;
          updated_at: string;
          winner_id: string | null;
        };
        Insert: {
          evening_id: string;
          first_out_id?: string | null;
          player_id: string;
          updated_at?: string;
          winner_id?: string | null;
        };
        Update: {
          evening_id?: string;
          first_out_id?: string | null;
          player_id?: string;
          updated_at?: string;
          winner_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'predictions_evening_id_fkey';
            columns: ['evening_id'];
            isOneToOne: false;
            referencedRelation: 'evenings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'predictions_first_out_id_fkey';
            columns: ['first_out_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'predictions_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'predictions_winner_id_fkey';
            columns: ['winner_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
      rsvps: {
        Row: {
          evening_id: string;
          player_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          evening_id: string;
          player_id: string;
          status: string;
          updated_at?: string;
        };
        Update: {
          evening_id?: string;
          player_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rsvps_evening_id_fkey';
            columns: ['evening_id'];
            isOneToOne: false;
            referencedRelation: 'evenings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rsvps_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
      season_rules: {
        Row: {
          best_n: number;
          frozen_at: string;
          season_key: string;
        };
        Insert: {
          best_n: number;
          frozen_at?: string;
          season_key: string;
        };
        Update: {
          best_n?: number;
          frozen_at?: string;
          season_key?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          announce_hours_before: number;
          bot_username: string | null;
          club_board_token: string;
          default_format_id: string | null;
          default_location: string | null;
          game_time: string;
          game_weekday: number;
          gameday_hours_before: number;
          group_chat_id: number | null;
          id: number;
          ko_points: number;
          season_best_n: number;
          updated_at: string;
          win_bonus: number;
        };
        Insert: {
          announce_hours_before?: number;
          bot_username?: string | null;
          club_board_token?: string;
          default_format_id?: string | null;
          default_location?: string | null;
          game_time?: string;
          game_weekday?: number;
          gameday_hours_before?: number;
          group_chat_id?: number | null;
          id?: number;
          ko_points?: number;
          season_best_n?: number;
          updated_at?: string;
          win_bonus?: number;
        };
        Update: {
          announce_hours_before?: number;
          bot_username?: string | null;
          club_board_token?: string;
          default_format_id?: string | null;
          default_location?: string | null;
          game_time?: string;
          game_weekday?: number;
          gameday_hours_before?: number;
          group_chat_id?: number | null;
          id?: number;
          ko_points?: number;
          season_best_n?: number;
          updated_at?: string;
          win_bonus?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'settings_default_format_id_fkey';
            columns: ['default_format_id'];
            isOneToOne: false;
            referencedRelation: 'formats';
            referencedColumns: ['id'];
          },
        ];
      };
      voice_clips: {
        Row: {
          audio: string;
          created_at: string;
          duration_ms: number;
          mime: string;
          text: string;
          text_hash: string;
          voice: string;
        };
        Insert: {
          audio: string;
          created_at?: string;
          duration_ms: number;
          mime?: string;
          text: string;
          text_hash: string;
          voice: string;
        };
        Update: {
          audio?: string;
          created_at?: string;
          duration_ms?: number;
          mime?: string;
          text?: string;
          text_hash?: string;
          voice?: string;
        };
        Relationships: [];
      };
      votes: {
        Row: {
          caption: string | null;
          category: string;
          created_at: string;
          evening_id: string;
          nominee_id: string;
          photo_path: string | null;
          voter_id: string;
        };
        Insert: {
          caption?: string | null;
          category: string;
          created_at?: string;
          evening_id: string;
          nominee_id: string;
          photo_path?: string | null;
          voter_id: string;
        };
        Update: {
          caption?: string | null;
          category?: string;
          created_at?: string;
          evening_id?: string;
          nominee_id?: string;
          photo_path?: string | null;
          voter_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'votes_evening_id_fkey';
            columns: ['evening_id'];
            isOneToOne: false;
            referencedRelation: 'evenings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'votes_nominee_id_fkey';
            columns: ['nominee_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'votes_voter_id_fkey';
            columns: ['voter_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_event: {
        Args: { p_client_id?: string; p_evening: string; p_payload?: Json; p_type: string };
        Returns: {
          at: string;
          client_id: string | null;
          created_by: string | null;
          evening_id: string;
          id: number;
          payload: NonNullable<Json>;
          type: string;
          voided_at: string | null;
          voided_by: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'evening_events';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      add_events: {
        Args: { p_client_id?: string; p_evening: string; p_events: Json };
        Returns: {
          at: string;
          client_id: string | null;
          created_by: string | null;
          evening_id: string;
          id: number;
          payload: NonNullable<Json>;
          type: string;
          voided_at: string | null;
          voided_by: string | null;
        }[];
        SetofOptions: {
          from: '*';
          to: 'evening_events';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      add_guest: {
        Args: {
          p_client_id?: string;
          p_evening: string;
          p_name: string;
          p_paid_rub?: number;
          p_stacks?: number;
        };
        Returns: string;
      };
      board_ping: { Args: { p_token: string; p_voice?: boolean }; Returns: boolean };
      board_state: { Args: { p_token: string }; Returns: Json };
      board_voice_clips: {
        Args: { p_hashes: string[]; p_token: string; p_voice: string };
        Returns: Json;
      };
      can_upload_vote_photo: { Args: { p_evening: string; p_player: string }; Returns: boolean };
      cast_vote: {
        Args: {
          p_caption?: string;
          p_category: string;
          p_evening: string;
          p_nominee: string;
          p_photo_path?: string;
        };
        Returns: undefined;
      };
      club_board_state: { Args: { p_code: string }; Returns: Json };
      club_board_voice_clips: {
        Args: { p_code: string; p_hashes: string[]; p_voice: string };
        Returns: Json;
      };
      cron_last_tick: { Args: Record<PropertyKey, never>; Returns: Json };
      current_player_id: { Args: Record<PropertyKey, never>; Returns: string };
      delete_training_evening: { Args: { p_evening: string }; Returns: Json };
      delete_vote: {
        Args: { p_category: string; p_evening: string; p_voter: string };
        Returns: undefined;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_banker: { Args: { evening: string }; Returns: boolean };
      is_participant: { Args: { evening: string; player: string }; Returns: boolean };
      mark_cron_tick: { Args: { p_ok: boolean }; Returns: undefined };
      mark_settled: {
        Args: { p_evening: string; p_last_event_id: number; p_voided_count: number };
        Returns: undefined;
      };
      merge_guests: { Args: { p_guest: string; p_target: string }; Returns: Json };
      merge_guests_preview: { Args: { p_guest: string; p_target: string }; Returns: Json };
      merge_players: { Args: { p_guest: string; p_target: string }; Returns: Json };
      merge_players_preview: { Args: { p_guest: string; p_target: string }; Returns: Json };
      rotate_club_board_token: { Args: Record<PropertyKey, never>; Returns: string };
      server_now: { Args: Record<PropertyKey, never>; Returns: string };
      set_my_name: { Args: { p_name: string }; Returns: undefined };
      set_my_spectator: { Args: { p_spectator: boolean }; Returns: boolean };
      set_my_spoken_name: { Args: { p_name: string }; Returns: string };
      set_payout: { Args: { p_evening: string; p_pct: number[] }; Returns: undefined };
      set_prediction: {
        Args: { p_evening: string; p_first_out: string; p_winner: string };
        Returns: undefined;
      };
      set_rsvp: { Args: { p_evening: string; p_status: string }; Returns: undefined };
      unmark_settled: { Args: { p_evening: string }; Returns: undefined };
      verify_cron_secret: { Args: { p_secret: string }; Returns: boolean };
      voice_clips_present: { Args: { p_hashes: string[]; p_voice: string }; Returns: string[] };
      void_event: { Args: { p_event: number }; Returns: undefined };
      void_events: { Args: { p_events: number[] }; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
