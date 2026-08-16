import { describe, expect, it, vi } from "vitest";
import {
  OpenAiResearchProvider,
  parseResearchResponse,
} from "../services/research/src/index.js";

const responseFixture = {
  id: "resp_1",
  output: [
    {
      type: "web_search_call",
      action: {
        type: "search",
        sources: [{ type: "url", url: "https://example.com/report" }],
      },
    },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "A sourced current answer.",
          annotations: [
            {
              type: "url_citation",
              title: "Current report",
              url: "https://example.com/report",
              start_index: 0,
              end_index: 8,
            },
          ],
        },
      ],
    },
  ],
};

describe("research provider", () => {
  it("normalizes cited web output with untrusted provenance", () => {
    const result = parseResearchResponse(
      responseFixture,
      "7cb5ddae-a2f8-46af-b45a-8a2056dc3617",
      new Date("2026-08-17T00:00:00.000Z"),
    );
    expect(result.answer).toBe("A sourced current answer.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      title: "Current report",
      provenance: { origin: "web", trusted: false },
    });
  });

  it("uses Responses web search without exposing the key in results", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(responseFixture));
    const provider = new OpenAiResearchProvider({
      apiKey: "unit-test-research-key",
      fetch: fetchMock,
    });
    const result = await provider.research(
      {
        requestId: "7cb5ddae-a2f8-46af-b45a-8a2056dc3617",
        query: "What happened today?",
      },
      {
        signal: new AbortController().signal,
        deadline: new Date(Date.now() + 5_000),
        correlationId: "correlation-1",
      },
    );
    expect(result.sources[0]?.url).toBe("https://example.com/report");
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer unit-test-research-key",
    });
    expect(JSON.stringify(result)).not.toContain("unit-test-research-key");
  });

  it("fails closed on unsourced output", () => {
    expect(() =>
      parseResearchResponse(
        { output_text: "No citation" },
        "7cb5ddae-a2f8-46af-b45a-8a2056dc3617",
      ),
    ).toThrow("no attributable sources");
  });
});
