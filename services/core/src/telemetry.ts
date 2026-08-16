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
  voiceConfigured = false,
): () => void {
  const logger = new Logger("telemetry");
  let previous = cpuTimes();
  let microphone: "ready" | "muted" | "unavailable" | "not_configured" =
    voiceConfigured ? "ready" : "not_configured";
  let voice:
    "idle" | "listening" | "speaking" | "unavailable" | "not_configured" =
    voiceConfigured ? "idle" : "unavailable";
  const unsubscribe = bus.subscribe((event) => {
    switch (event.type) {
      case "voice.connected":
      case "voice.listening":
      case "voice.user_speaking":
      case "voice.processing":
        microphone =
          event.type === "voice.listening" && event.payload.muted
            ? "muted"
            : "ready";
        voice = "listening";
        return;
      case "voice.speaking":
        microphone = "ready";
        voice = "speaking";
        return;
      case "voice.muted.changed":
        microphone = event.payload.muted ? "muted" : "ready";
        return;
      case "voice.disconnected":
        microphone = voiceConfigured ? "ready" : "not_configured";
        voice = voiceConfigured ? "idle" : "unavailable";
        return;
      case "voice.failed":
        voice = "unavailable";
        return;
      default:
        return;
    }
  });
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
        microphone,
        voice,
        core: "online",
        codexAgents: 0,
      }),
      { durable: false },
    );
  };
  void sample();
  const timer = setInterval(() => void sample(), intervalMs);
  timer.unref();
  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}
