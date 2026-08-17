import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { notificationSchema, type Notification } from "@jarvis/protocol";
import { coreRequest } from "./core-client";

const responseSchema = z.strictObject({
  notifications: z.array(notificationSchema),
});

export function NotificationCenter({ onClose }: { onClose: () => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const response = await coreRequest("/notifications/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unreadOnly: false, limit: 100 }),
      });
      if (!response.ok)
        throw new Error(
          `Notification retrieval failed (${String(response.status)})`,
        );
      setNotifications(
        responseSchema.parse(await response.json()).notifications,
      );
      setError(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Notification retrieval failed",
      );
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const acknowledge = async (notificationId: string): Promise<void> => {
    const response = await coreRequest("/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationId }),
    });
    if (!response.ok) {
      setError(
        `Notification acknowledgement failed (${String(response.status)})`,
      );
      return;
    }
    await refresh();
  };

  return (
    <div className="modal-backdrop">
      <section className="notification-center" aria-label="Notification center">
        <div className="panel-heading">
          <h2>NOTIFICATION CENTER</h2>
          <button onClick={onClose} type="button">
            CLOSE
          </button>
        </div>
        <p className="memory-policy">
          Background completions and failures appear once. Spoken interruption
          is disabled by default.
        </p>
        {error ? <p className="empty">{error}</p> : null}
        <div className="memory-list">
          {notifications.length === 0 ? (
            <p className="empty">No notifications</p>
          ) : null}
          {notifications.map((notification) => (
            <article
              className={notification.readAt ? "read" : ""}
              key={notification.id}
            >
              <small>
                {notification.severity.toUpperCase()} //{" "}
                {notification.type.toUpperCase()}
              </small>
              <p>
                <strong>{notification.title}</strong>
                <br />
                {notification.body}
              </p>
              {!notification.readAt ? (
                <button
                  onClick={() => void acknowledge(notification.id)}
                  type="button"
                >
                  ACKNOWLEDGE
                </button>
              ) : (
                <small>ACKNOWLEDGED</small>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
