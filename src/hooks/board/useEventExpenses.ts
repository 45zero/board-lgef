"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface EventExpense {
  id: string;
  event_id: string;
  user_id: string;
  toll_fees: number | null;
  meal_fees: number | null;
  other_fees: number | null;
  other_fees_description: string | null;
  total_amount: number | null;
  created_at: string;
}

export type ExpensePayload = Partial<
  Pick<EventExpense, "toll_fees" | "meal_fees" | "other_fees" | "other_fees_description">
>;

/** Porté de calendrier-lgef/src/hooks/useEventExpenses.ts (profile.id -> user.id, même colonne). */
export function useEventExpenses(eventId: string) {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<EventExpense[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!eventId || !user?.id) return;
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("event_expenses")
      .select("*")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setExpenses((data as EventExpense[] | null) ?? []);
    setLoading(false);
  }, [eventId, user?.id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createExpense = async (payload: ExpensePayload) => {
    if (!user?.id) return false;
    const supabase = createClient();
    const total = (payload.toll_fees ?? 0) + (payload.meal_fees ?? 0) + (payload.other_fees ?? 0);
    const { data, error } = await supabase
      .from("event_expenses")
      .insert({ event_id: eventId, user_id: user.id, total_amount: total, ...payload })
      .select()
      .single();
    if (!error) setExpenses((p) => [data as EventExpense, ...p]);
    return !error;
  };

  const updateExpense = async (id: string, payload: ExpensePayload) => {
    if (!user?.id) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("event_expenses")
      .update(payload)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();
    if (!error) setExpenses((p) => p.map((e) => (e.id === id ? (data as EventExpense) : e)));
    return !error;
  };

  const deleteExpense = async (id: string) => {
    if (!user?.id) return false;
    const supabase = createClient();
    const { error } = await supabase.from("event_expenses").delete().eq("id", id).eq("user_id", user.id);
    if (!error) setExpenses((p) => p.filter((e) => e.id !== id));
    return !error;
  };

  return { expenses, loading, createExpense, updateExpense, deleteExpense, refetch };
}
