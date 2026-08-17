import {
  routeDecisionSchema,
  type RouteDecision,
  type RouteRequest,
  type ToolRoute,
} from "@jarvis/protocol";

interface RouteFeatures {
  route: ToolRoute;
  patterns: RegExp[];
  contextBonus?: (request: RouteRequest) => number;
  reason: string;
}

const features: RouteFeatures[] = [
  {
    route: "deployment",
    patterns: [/\bdeploy(?:ment)?\b/i, /\bproduction\b/i, /\broll\s?back\b/i],
    contextBonus: ({ activeProjectId }) => (activeProjectId ? 0.35 : 0),
    reason: "deployment lifecycle language",
  },
  {
    route: "git",
    patterns: [/\bpush\b/i, /\bcommit\b/i, /\bmerge\b/i, /\bbranch\b/i],
    contextBonus: ({ activeTaskId }) => (activeTaskId ? 0.35 : 0),
    reason: "Git operation language",
  },
  {
    route: "coding",
    patterns: [
      /\b(fix|implement|refactor|add|remove|change|update)\b/i,
      /\b(bug|test|build|code|component|function|class|api)\b/i,
      /\b(codex|coding agent|diff|revert|pause|resume|cancel)\b/i,
    ],
    contextBonus: ({ activeProjectId }) => (activeProjectId ? 0.4 : 0),
    reason: "code modification intent",
  },
  {
    route: "project",
    patterns: [
      /\b(project|repository|repo|codebase)\b/i,
      /\b(where|how)\b.+\b(implemented|defined|configured|works)\b/i,
      /\b(authentication|route|schema|service|architecture)\b/i,
    ],
    contextBonus: ({ activeProjectId }) => (activeProjectId ? 0.24 : 0),
    reason: "local project knowledge intent",
  },
  {
    route: "research",
    patterns: [
      /\b(latest|today|currently|current|recent|news|newest|this week)\b/i,
      /\b(search|research|look up|find out)\b(?:.+\b(web|online|internet)\b)?/i,
      /\bwhat(?:'s| is) happening\b/i,
    ],
    reason: "fresh public information requested",
  },
  {
    route: "browser",
    patterns: [
      /\b(open|navigate|browse|scroll|click|reload)\b.+\b(page|site|url|documentation|docs)\b/i,
      /https?:\/\//i,
    ],
    reason: "interactive browser intent",
  },
  {
    route: "system",
    patterns: [
      /\b(volume|application|window|monitor|explorer|terminal)\b/i,
      /\b(open|close|move|resize|set|mute|launch)\b.+\b(app|application|window|volume|explorer|terminal)\b/i,
    ],
    reason: "local system-control intent",
  },
  {
    route: "reference",
    patterns: [
      /\b(show|display)\b.+\b(image|video|reference|other monitor|second monitor)\b/i,
    ],
    reason: "reference display intent",
  },
  {
    route: "memory",
    patterns: [/\bremember\b/i, /\bforget\b.+\b(preference|that|this)\b/i],
    reason: "explicit memory intent",
  },
];

const toolCatalog: Record<ToolRoute, [string, string, string, ...string[]]> = {
  conversation: ["conversation.respond", "conversation.clarify", "tool.search"],
  research: [
    "research.search",
    "research.fetch_source",
    "research.cancel",
    "tool.search",
  ],
  project: [
    "project.resolve",
    "project.search",
    "project.inspect_file",
    "tool.search",
  ],
  coding: ["codex.create_task", "codex.status", "codex.message", "tool.search"],
  browser: [
    "browser.open_url",
    "browser.find_text",
    "browser.open_reference",
    "tool.search",
  ],
  system: [
    "system.get_stats",
    "system.get_running_apps",
    "system.open_url",
    "tool.search",
  ],
  git: ["git.status", "git.diff", "git.resolve_task", "tool.search"],
  deployment: [
    "deployment.inspect",
    "deployment.validate",
    "deployment.propose",
    "tool.search",
  ],
  reference: [
    "reference.show",
    "reference.clear",
    "reference.get_state",
    "tool.search",
  ],
  memory: ["memory.remember", "memory.recall", "memory.forget", "tool.search"],
};

function clamp(score: number): number {
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

export class IntentRouter {
  route(request: RouteRequest): RouteDecision {
    const scores = new Map<ToolRoute, { score: number; reasons: string[] }>();
    scores.set("conversation", {
      score: 0.32,
      reasons: ["general conversation baseline"],
    });
    for (const feature of features) {
      const matches = feature.patterns.filter((pattern) =>
        pattern.test(request.text),
      ).length;
      if (matches === 0) continue;
      const contextBonus = feature.contextBonus?.(request) ?? 0;
      const score = clamp(0.42 + matches * 0.2 + contextBonus);
      const current = scores.get(feature.route);
      if (!current || score > current.score)
        scores.set(feature.route, {
          score,
          reasons: [
            feature.reason,
            ...(contextBonus ? ["active context supports route"] : []),
          ],
        });
    }
    const ranked = [...scores.entries()]
      .map(([route, value]) => ({ route, ...value }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0] ?? {
      route: "conversation" as const,
      score: 0.32,
      reasons: ["general conversation baseline"],
    };
    const runnerUp = ranked[1];
    const requiresClarification =
      best.route !== "conversation" &&
      (best.score < 0.55 ||
        (runnerUp !== undefined && best.score - runnerUp.score < 0.08));
    return routeDecisionSchema.parse({
      requestId: request.requestId,
      route: best.route,
      confidence: best.score,
      candidates: ranked
        .slice(0, 4)
        .map(({ route, score }) => ({ route, score })),
      toolShortlist: toolCatalog[best.route],
      reasons: best.reasons,
      requiresClarification,
    });
  }
}
