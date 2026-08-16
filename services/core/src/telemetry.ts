import { statfsSync } from "node:fs";
import { cpus, freemem, networkInterfaces, totalmem } from "node:os";
import type { LocalEventBus } from "@jarvis/event-bus";
import { Logger } from "@jarvis/logging";

interface CpuTimes {
  idle: number;
  total: number;
}

function cpuTimes(): CpuTimes {
  return cpus().reduce(
    (sum, cpu) => {
      const total = Object.values(cpu.times).reduce(
        (accumulator, value) => accumulator + value,
        0,
      );
      return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
    },
    { idle: 0, total: 0 },
  );
}

function networkState(): "online" | "offline" | "unknown" {
  const interfaces = Object.values(networkInterfaces()).flatMap(
    (entries) => entries ?? [],
  );
  if (interfaces.length === 0) return "unknown";
  return interfaces.some((entry) => !entry.internal) ? "online" : "offline";
}

export function startTelemetry(
  bus: LocalEventBus,
  diskPath: string,
  intervalMs = 2_000,
): () => void {
  const logger = new Logger("telemetry");
  let previous = cpuTimes();
  const sample = async (): Promise<void> => {
    const current = cpuTimes();
    const totalDelta = current.total - previous.total;
    const idleDelta = current.idle - previous.idle;
    previous = current;
    const cpuPercent =
      totalDelta > 0
        ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))
        : 0;
    const ramTotalBytes = totalmem();
    let disk: { diskUsedBytes?: number; diskTotalBytes?: number } = {};
    try {
      const stats = statfsSync(diskPath);
      const diskTotalBytes = stats.blocks * stats.bsize;
      disk = {
        diskTotalBytes,
        diskUsedBytes: Math.max(0, diskTotalBytes - stats.bavail * stats.bsize),
      };
    } catch (error) {
      logger.log("warn", "disk.sample_failed", {
        message:
          error instanceof Error
            ? error.message
            : "Unknown disk sampling failure",
      });
    }
    await bus.publish(
      bus.create("system.telemetry", "core.telemetry", {
        cpuPercent,
        ramUsedBytes: ramTotalBytes - freemem(),
        ramTotalBytes,
        ...disk,
        network: networkState(),
        microphone: "not_configured",
        voice: "not_configured",
        core: "online",
        codexAgents: 0,
      }),
      { durable: false },
    );
  };
  void sample();
  const timer = setInterval(() => void sample(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
