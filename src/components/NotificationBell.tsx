import React from "react";
import { Bell } from "lucide-react";
import { useAuthUser } from "@/hooks/useAuthUser";
import { fetchUnreadCount } from "@/lib/notificationUtils";

interface Props {
  unreadCount: number; // keep your prop as-is
}

const NotificationsBell: React.FC<Props> = ({ unreadCount }) => {
  const { user } = useAuthUser();
  const [count, setCount] = React.useState(unreadCount);

  // Keep prop as the baseline (in case parent updates it)
  React.useEffect(() => {
    setCount(unreadCount);
  }, [unreadCount]);

  // Ensure badge is correct on mount / when user changes
  React.useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      if (!user?.id) return;
      try {
        const c = await fetchUnreadCount(user.id);
        if (!cancelled) setCount(c);
      } catch {
        /* noop */
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Listen for updates from the Notifications page and when tab becomes visible
  React.useEffect(() => {
    const refresh = async () => {
      if (!user?.id) return;
      try {
        const c = await fetchUnreadCount(user.id);
        setCount(c);
      } catch {
        /* noop */
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("notifications:updated", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("notifications:updated", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user?.id]);

  return (
    <div className="relative">
      <Bell className="h-6 w-6" aria-hidden />
      {count > 0 && (
        <span
          className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-red-500 text-white text-[10px] leading-5 text-center"
          aria-label={`${count} unread notifications`}
        >
          {count}
        </span>
      )}
    </div>
  );
};

export default NotificationsBell;
