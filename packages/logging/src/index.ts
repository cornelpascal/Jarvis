const secretKey = /(?:api[_-]?key|authorization|cookie|password|secret|token)/i;
const secretValue =
  /(?:sk|pk|ghp|gho|ghu|ghs|ghr)[_-][A-Za-z0-9_-]{12,}|Bearer\s+\S+/gi;

export type LogLevel = "debug" | "info" | "warn" | "error";

export function redact(value: unknown, key = ""): unknown {
  if (secretKey.test(key)) return "[REDACTED]";
  if (typeof value === "string")
    return value.replaceAll(secretValue, "[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redact(child, childKey),
      ]),
    );
  }
  return value;
}

export class Logger {
  public constructor(private readonly component: string) {}

  public log(
    level: LogLevel,
    event: string,
    fields: Record<string, unknown> = {},
  ): void {
    const entry = redact({
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      event,
      ...fields,
    });
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}
