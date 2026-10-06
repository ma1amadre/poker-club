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
      evening_events: {
        Row: {
          at: string;
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
          banker_id: string | null;
          board_token: string;
          created_at: string;
          created_by: string | null;
          finished_at: string | null;
          format: NonNullable<Json>;
          id: string;
          location: string | null;
          note: string | null;
          results_posted_at: string | null;
          scheduled_at: string;
          settled_at: string | null;
          started_at: string | null;
          status: string;
          voting_closes_at: string | null;
          voting_posted_at: string | null;
        };
        Insert: {
          announce_posted_at?: string | null;
          banker_id?: string | null;
          board_token?: string;
          created_at?: string;
          created_by?: string | null;
          finished_at?: string | null;
          format: NonNullable<Json>;
          id?: string;
          location?: string | null;
          note?: string | null;
          results_posted_at?: string | null;
          scheduled_at: string;
          settled_at?: string | null;
          started_at?: string | null;
          status?: string;
          voting_closes_at?: string | null;
          voting_posted_at?: string | null;
        };
        Update: {
          announce_posted_at?: string | null;
          banker_id?: string | null;
          board_token?: string;
          created_at?: string;
          created_by?: string | null;
          finished_at?: string | null;
          format?: NonNullable<Json>;
          id?: string;
          location?: string | null;
          note?: string | null;
          results_posted_at?: string | null;
          scheduled_at?: string;
          settled_at?: string | null;
          started_at?: string | null;
          status?: string;
          voting_closes_at?: string | null;
          voting_posted_at?: string | null;
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
          photo_url: string | null;
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
          photo_url?: string | null;
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
          photo_url?: string | null;
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
      settings: {
        Row: {
          announce_hours_before: number;
          bot_username: string | null;
          default_format_id: string | null;
          default_location: string | null;
          game_time: string;
          game_weekday: number;
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
          default_format_id?: string | null;
          default_location?: string | null;
          game_time?: string;
          game_weekday?: number;
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
          default_format_id?: string | null;
          default_location?: string | null;
          game_time?: string;
          game_weekday?: number;
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
        Args: { p_evening: string; p_payload?: Json; p_type: string };
        Returns: {
          at: string;
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
      board_state: { Args: { p_token: string }; Returns: Json };
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
      current_player_id: { Args: Record<PropertyKey, never>; Returns: string };
      delete_vote: {
        Args: { p_category: string; p_evening: string; p_voter: string };
        Returns: undefined;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_banker: { Args: { evening: string }; Returns: boolean };
      is_participant: { Args: { evening: string; player: string }; Returns: boolean };
      mark_settled: { Args: { p_evening: string }; Returns: undefined };
      set_my_name: { Args: { p_name: string }; Returns: undefined };
      set_prediction: {
        Args: { p_evening: string; p_first_out: string; p_winner: string };
        Returns: undefined;
      };
      set_rsvp: { Args: { p_evening: string; p_status: string }; Returns: undefined };
      unmark_settled: { Args: { p_evening: string }; Returns: undefined };
      void_event: { Args: { p_event: number }; Returns: undefined };
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
