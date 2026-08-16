import { describe, expect, it } from "vitest";
import type { MonitorInfo } from "../packages/os-abstractions/src/index.js";
import { resolvePlacement } from "../apps/dashboard/src/display-provider.js";

const primary: MonitorInfo = {
  id: "primary",
  name: "Display 1",
  primary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1,
};
const secondary: MonitorInfo = {
  id: "secondary",
  name: "Display 2",
  primary: false,
  x: 1920,
  y: 0,
  width: 2560,
  height: 1440,
  scaleFactor: 1.25,
};

describe("display placement", () => {
  it("defaults the reference deck to a different monitor", () => {
    expect(resolvePlacement([primary, secondary])).toEqual({
      dashboardMonitorId: "primary",
      referenceMonitorId: "secondary",
    });
  });

  it("preserves valid choices and recovers from disconnected displays", () => {
    expect(
      resolvePlacement([primary, secondary], {
        dashboardMonitorId: "secondary",
        referenceMonitorId: "primary",
      }),
    ).toEqual({
      dashboardMonitorId: "secondary",
      referenceMonitorId: "primary",
    });
    expect(
      resolvePlacement([primary], {
        dashboardMonitorId: "missing",
        referenceMonitorId: "missing",
      }),
    ).toEqual({ dashboardMonitorId: "primary", referenceMonitorId: "primary" });
  });

  it("returns no placement when no display is available", () => {
    expect(resolvePlacement([])).toBeUndefined();
  });
});
