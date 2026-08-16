import { describe, expect, it } from "vitest";
import { redact } from "../packages/logging/src/index.js";

describe("logging redaction", () => {
  it("redacts secret keys and bearer tokens recursively", () => {
    expect(
      redact({
        apiKey: "sensitive",
        nested: { authorization: "Bearer abc" },
        note: "Bearer secret-value",
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]" },
      note: "[REDACTED]",
    });
  });
});
