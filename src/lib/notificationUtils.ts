// src/lib/notificationUtils.ts
import { supabase } from "@/lib/supabase";

// mark BOTH flags so every query agrees it's read
export const markNotificationAsRead = async (id: string) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true, is_read: true, seen: true })
    .eq("id", id);

  if (error) throw error;
  return true;
};

// (matches me) AND (is unread) — grouped OR syntax for PostgREST
const unreadOrGroups = (uid: string) =>
  `and(user_id.eq.${uid},or(read.eq.false,is_read.eq.false)),` +
  `and(recipient_id.eq.${uid},or(read.eq.false,is_read.eq.false))`;

export const fetchUnreadNotifications = async (uid: string) => {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .or(unreadOrGroups(uid))
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
};

export const fetchUnreadCount = async (uid: string) => {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { head: true, count: "exact" })
    .or(unreadOrGroups(uid));

  if (error) throw error;
  return count ?? 0;
};

export const fetchAllNotificationsForUser = async (uid: string) => {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .or(`user_id.eq.${uid},recipient_id.eq.${uid}`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
};
