import { useCallback, useEffect, useMemo, useState } from "react";
import type { MonitorInfo } from "@jarvis/os-abstractions";
import {
  createDisplayProvider,
  loadDisplayPlacement,
  resolvePlacement,
  saveDisplayPlacement,
} from "./display-provider";

export function DisplaySettings({ onClose }: { onClose: () => void }) {
  const provider = useMemo(() => createDisplayProvider(), []);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [placement, setPlacement] = useState(loadDisplayPlacement);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const available = await provider.listMonitors();
      const resolved = resolvePlacement(available, placement);
      setMonitors(available);
      if (resolved) {
        if (
          resolved.dashboardMonitorId !== placement.dashboardMonitorId ||
          resolved.referenceMonitorId !== placement.referenceMonitorId
        ) {
          setPlacement(resolved);
          saveDisplayPlacement(resolved);
        }
      }
      setError(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Display discovery failed",
      );
    }
  }, [placement, provider]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(poll);
  }, [refresh]);

  const update = (
    key: "dashboardMonitorId" | "referenceMonitorId",
    value: string,
  ) => {
    const next = { ...placement, [key]: value };
    setPlacement(next);
    saveDisplayPlacement(next);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="display-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="display-title"
      >
        <div className="panel-heading">
          <h2 id="display-title">DISPLAY ROUTING</h2>
          <button onClick={onClose} type="button">
            CLOSE
          </button>
        </div>
        <div className="settings-body">
          <p>
            {monitors.length > 1
              ? `${String(monitors.length)} displays detected`
              : "Single-display fallback active"}
          </p>
          <label>
            HUD MONITOR
            <select
              value={placement.dashboardMonitorId ?? ""}
              onChange={(event) =>
                update("dashboardMonitorId", event.target.value)
              }
            >
              {monitors.map((monitor) => (
                <option key={monitor.id} value={monitor.id}>
                  {monitor.name}
                  {monitor.primary ? " // PRIMARY" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            REFERENCE MONITOR
            <select
              value={placement.referenceMonitorId ?? ""}
              onChange={(event) =>
                update("referenceMonitorId", event.target.value)
              }
            >
              {monitors.map((monitor) => (
                <option key={monitor.id} value={monitor.id}>
                  {monitor.name}
                  {monitor.primary ? " // PRIMARY" : ""}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="settings-error">{error}</p> : null}
          <div className="settings-actions">
            <button
              type="button"
              onClick={() =>
                placement.dashboardMonitorId &&
                void provider.placeDashboard(placement.dashboardMonitorId)
              }
            >
              MOVE HUD
            </button>
            <button
              type="button"
              onClick={() =>
                void provider.openReferenceDeck(placement.referenceMonitorId)
              }
            >
              OPEN REFERENCE DECK
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
