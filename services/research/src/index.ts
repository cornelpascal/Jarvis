import { createHash } from "node:crypto";
import {
  researchResultSchema,
  type OperationContext,
  type ProviderHealth,
  type ResearchProvider,
  type ResearchRequest,
  type ResearchResult,
  type SourceReference,
} from "@jarvis/protocol";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export class ResearchProviderError extends Error {
  override readonly name = "ResearchProviderError";

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface OpenAiResearchProviderOptions {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseResearchResponse(
  input: unknown,
  requestId: string,
  now = new Date(),
): ResearchResult {
  const root = record(input);
  if (!root)
    throw new ResearchProviderError(
      "INVALID_RESEARCH_RESPONSE",
      "Research provider returned malformed data",
      true,
    );
  const textParts: string[] = [];
  const sources = new Map<string, SourceReference>();
  const addSource = (urlValue: unknown, titleValue?: unknown): void => {
    const url = safeWebUrl(urlValue);
    if (!url) return;
    const existing = sources.get(url);
    if (existing) {
      if (typeof titleValue === "string" && titleValue.trim())
        sources.set(url, { ...existing, title: titleValue.trim() });
      return;
    }
    const title =
      typeof titleValue === "string" && titleValue.trim()
        ? titleValue.trim()
        : new URL(url).hostname;
    sources.set(url, {
      id: createHash("sha256").update(url).digest("hex").slice(0, 16),
      title,
      url,
      retrievedAt: now.toISOString(),
      provenance: { origin: "web", trusted: false, source: url },
    });
  };
  for (const outputValue of Array.isArray(root.output) ? root.output : []) {
    const output = record(outputValue);
    if (!output) continue;
    for (const contentValue of Array.isArray(output.content)
      ? output.content
      : []) {
      const content = record(contentValue);
      if (!content || content.type !== "output_text") continue;
      if (typeof content.text === "string" && content.text.trim())
        textParts.push(content.text.trim());
      for (const annotationValue of Array.isArray(content.annotations)
        ? content.annotations
        : []) {
        const annotation = record(annotationValue);
        if (annotation?.type === "url_citation")
          addSource(annotation.url, annotation.title);
      }
    }
    const action = record(output.action);
    for (const sourceValue of Array.isArray(action?.sources)
      ? action.sources
      : []) {
      const source = record(sourceValue);
      addSource(source?.url);
    }
  }
  const answer =
    textParts.join("\n\n") ||
    (typeof root.output_text === "string" ? root.output_text.trim() : "");
  if (!answer)
    throw new ResearchProviderError(
      "RESEARCH_ANSWER_MISSING",
      "Research provider returned no answer",
      true,
    );
  if (sources.size === 0)
    throw new ResearchProviderError(
      "RESEARCH_SOURCES_MISSING",
      "Research provider returned no attributable sources",
      true,
    );
  return researchResultSchema.parse({
    requestId,
    answer,
    sources: [...sources.values()],
    images: [],
    videos: [],
    visualRecommendation: {
      display: false,
      score: 0,
      reason: "Reference evaluation is deferred to Phase 7",
      preferredMode: "none",
    },
  });
}

export class OpenAiResearchProvider implements ResearchProvider {
  readonly #apiKey: string | undefined;
  readonly #model: string;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAiResearchProviderOptions = {}) {
    this.#apiKey = options.apiKey?.trim() || undefined;
    this.#model = options.model ?? "gpt-5-mini";
    this.#fetch = options.fetch ?? fetch;
  }

  health(): Promise<ProviderHealth> {
    return Promise.resolve(
      this.#apiKey
        ? { status: "available", capabilities: ["web-search", "citations"] }
        : {
            status: "unavailable",
            message: "OPENAI_API_KEY is not configured in JARVIS Core",
            capabilities: [],
          },
    );
  }

  async research(
    request: ResearchRequest,
    context: OperationContext,
  ): Promise<ResearchResult> {
    if (!this.#apiKey)
      throw new ResearchProviderError(
        "RESEARCH_NOT_CONFIGURED",
        "Web research is not configured",
        false,
      );
    const deadlineMs = Math.max(1, context.deadline.getTime() - Date.now());
    let response: Response;
    try {
      response = await this.#fetch(RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#model,
          tools: [{ type: "web_search" }],
          input: request.query,
        }),
        signal: AbortSignal.any([
          context.signal,
          AbortSignal.timeout(deadlineMs),
        ]),
      });
    } catch {
      throw new ResearchProviderError(
        "RESEARCH_UNAVAILABLE",
        "Web research request failed",
        true,
      );
    }
    if (!response.ok)
      throw new ResearchProviderError(
        "RESEARCH_REJECTED",
        `Web research provider rejected the request (${String(response.status)})`,
        response.status === 429 || response.status >= 500,
      );
    return parseResearchResponse(await response.json(), request.requestId);
  }
}

export { SmartReferenceEvaluator } from "./reference-evaluator.js";
