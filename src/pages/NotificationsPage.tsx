import { useEffect, useState, useCallback } from "react";
import { Navbar } from "@/components/ui/navbar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useNavigate } from "react-router-dom";
import {
  fetchUnreadNotifications,
  markNotificationAsRead,
} from "@/lib/notificationUtils";
import { supabase } from "@/lib/supabase";

type AppNotification = {
  id: string;
  user_id: string | null;
  recipient_id: string | null;
  created_at: string;
  read?: boolean | null;
  is_read?: boolean | null;
  kind: string | null;
  title: string | null;
  body: string | null;
  payload: any;
  seen?: boolean | null;
};

export default function NotificationsPage() {
  const { user } = useAuthUser();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // grouped OR for "read" items:
  // ( user_id = me AND (read OR is_read) ) OR ( recipient_id = me AND (read OR is_read) )
  const orGroupsForRead = (uid: string) =>
    `and(user_id.eq.${uid},or(read.eq.true,is_read.eq.true)),and(recipient_id.eq.${uid},or(read.eq.true,is_read.eq.true))`;

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // 1) Unread first (already uses grouped OR inside the util)
      const unread = await fetchUnreadNotifications(user.id);

      // 2) Then fetch "read" using a *single* grouped OR (the key fix)
      const { data: readRows, error } = await supabase
        .from("notifications")
        .select("*")
        .or(orGroupsForRead(user.id))
        .order("created_at", { ascending: false });

      if (error) throw error;

      // 3) Merge (dedupe by id so nothing appears twice)
      const unreadIds = new Set(unread.map((n: any) => n.id));
      const rest = (readRows ?? []).filter((n: any) => !unreadIds.has(n.id));

      setItems([...(unread ?? []), ...rest]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // initial load
  useEffect(() => {
    if (user?.id) load();
  }, [user?.id, load]);

  // refresh when other parts of the app update notifications, and when tab returns visible
  useEffect(() => {
    const onUpdated = () => load();
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("notifications:updated", onUpdated);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("notifications:updated", onUpdated);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const openItem = async (n: AppNotification) => {
    const alreadyRead = n.read === true || n.is_read === true;
    if (!alreadyRead) {
      try {
        await markNotificationAsRead(n.id);
        setItems((prev) =>
          prev.map((x) =>
            x.id === n.id ? { ...x, read: true, is_read: true, seen: true } : x
          )
        );
        // 🔔 tell the bell to refresh its badge everywhere
        window.dispatchEvent(new Event("notifications:updated"));
      } catch {
        // optional: toast error
      }
    }

    // simple routing based on kind (kept as-is, just explicit fallbacks)
    if (n.kind === "booking.completed") {
      navigate("/sessions");
    } else if (n.kind && n.kind.startsWith("booking.")) {
      // mentor/client booking-related notifications
      // mentors commonly handle actions from their dashboard
      navigate("/sessions");
    }
  };

  // compute unread count for the Navbar badge
  const unreadCount = items.reduce(
    (acc, i) => (i.read || i.is_read ? acc : acc + 1),
    0
  );

  return (
    <>
      <Navbar unreadCount={unreadCount} />
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-semibold mb-4">Notifications</h1>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notifications.</p>
        ) : (
          items.map((n) => {
            const isRead = n.read === true || n.is_read === true;
            return (
              <Card
                key={n.id}
                className={`mb-3 ${isRead ? "opacity-70" : "border-primary/50"}`}
                role="button"
                tabIndex={0}
                onClick={() => openItem(n)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openItem(n);
                  }
                }}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{n.title ?? n.kind ?? "Notification"}</span>
                    {!isRead && (
                      <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary">
                        New
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {n.body && <p className="text-sm">{n.body}</p>}
                  {n.kind === "booking.completed" && (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate("/sessions");
                      }}
                    >
                      Review mentor
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}
