const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof EFFORT_LEVELS[number] | "off";

export interface DiscoveredModel {
  id: string;
  name?: string;
  // Capabilities the upstream list publishes, as models.json fields (#856).
  // `false` is a declaration too: pi reads an absent `reasoning` as support, so
  // a gateway that publishes `reasoning: false` has to reach models.json as
  // `false`, not as a missing key.
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  contextWindow?: number;
  maxTokens?: number;
}

// Only fields whose meaning does not vary between gateways. `max_tokens` is
// left out: LiteLLM, for one, fills it with either the input or output limit.
const CONTEXT_WINDOW_FIELDS = [
  "context_length", "contextLength", "context_window", "contextWindow",
  "max_model_len", "max_input_tokens", "inputTokenLimit",
];
const MAX_TOKENS_FIELDS = ["max_output_tokens", "maxOutputTokens", "max_completion_tokens", "outputTokenLimit"];
const REASONING_FIELDS = ["supports_reasoning", "supportsReasoning", "reasoning", "thinking"];
// Gateways name the advertised levels differently: a plain list of pi's own
// levels, or objects naming one (`supported_reasoning_levels`).
const EFFORT_LIST_FIELDS = ["supported_efforts", "supportedEfforts", "supported_reasoning_levels"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstPositiveInteger(value: Record<string, unknown>, fields: readonly string[]): number | undefined {
  for (const field of fields) {
    const raw = value[field];
    const number = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
    if (typeof number === "number" && Number.isSafeInteger(number) && number > 0) return number;
  }
  return undefined;
}

function advertisedLevel(entry: unknown): string | undefined {
  if (typeof entry === "string") return cleanString(entry);
  if (isRecord(entry)) return cleanString(entry.effort);
  return undefined;
}

/**
 * The first boolean a gateway publishes under one of the reasoning field names.
 * The value is kept as published: `true` and `false` are both declarations, and
 * only an absent field leaves the key out of the entry. Non-boolean values
 * (`"yes"`, numbers) are not declarations and stay ignored.
 */
function reasoningFromValue(value: Record<string, unknown>): boolean | undefined {
  for (const field of REASONING_FIELDS) {
    const raw = value[field];
    if (typeof raw === "boolean") return raw;
  }
  return undefined;
}

/**
 * An advertised level list names pi's own levels, which pi sends as the effort
 * when thinkingLevelMap has no entry. Every level of EFFORT_LEVELS is written:
 * an advertised one maps to itself, the rest are unsupported (null) — `xhigh` /
 * `max` need an entry to be offered at all. `off` is one of pi's levels too, but
 * the key is written only when the list names it: a list that does not say
 * whether thinking can be turned off leaves `off` untouched. Levels pi does not
 * know (`none`, `ultra`) are dropped, and a list naming none of pi's levels maps
 * nothing.
 */
function thinkingLevelMapFromEfforts(value: Record<string, unknown>): DiscoveredModel["thinkingLevelMap"] {
  const list = EFFORT_LIST_FIELDS.map((field) => value[field]).find(Array.isArray);
  if (!list) return undefined;
  const advertised = new Set<string>();
  for (const entry of list) {
    const level = advertisedLevel(entry);
    if (level) advertised.add(level);
  }
  if (!EFFORT_LEVELS.some((level) => advertised.has(level))) return undefined;
  const map: NonNullable<DiscoveredModel["thinkingLevelMap"]> = {};
  for (const level of EFFORT_LEVELS) map[level] = advertised.has(level) ? level : null;
  if (advertised.has("off")) map.off = "off";
  return map;
}

function capabilitiesFromValue(value: Record<string, unknown>): Omit<DiscoveredModel, "id" | "name"> {
  const reasoning = reasoningFromValue(value);
  // A level list only means something for a model that can reason at all.
  const thinkingLevelMap = reasoning === true ? thinkingLevelMapFromEfforts(value) : undefined;
  const contextWindow = firstPositiveInteger(value, CONTEXT_WINDOW_FIELDS);
  const maxTokens = firstPositiveInteger(value, MAX_TOKENS_FIELDS);
  return {
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
  };
}

function modelFromValue(value: unknown): DiscoveredModel | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id } : null;
  }
  if (!isRecord(value)) return null;

  const rawId = cleanString(value.id) ?? cleanString(value.model) ?? cleanString(value.name);
  if (!rawId) return null;
  const id = rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId;
  if (!id) return null;
  // A gateway may publish its own label for a routed model (`magpie_label`),
  // which names it more precisely than the upstream display name.
  const name = cleanString(value.magpie_label)
    ?? cleanString(value.display_name)
    ?? cleanString(value.displayName)
    ?? (cleanString(value.id) || cleanString(value.model) ? cleanString(value.name) : undefined);
  return { id, ...(name && name !== id ? { name } : {}), ...capabilitiesFromValue(value) };
}

function listFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["data", "models", "results", "items"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) return Object.values(candidate);
  }
  return [];
}

export function parseDiscoveredModels(value: unknown): DiscoveredModel[] {
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of listFromResponse(value)) {
    const model = modelFromValue(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

export function buildModelsListUrl(baseUrl: string, api: string): URL {
  const url = new URL(baseUrl.trim());
  const trimmedPath = url.pathname.replace(/\/+$/, "");

  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (api === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1";
    if (api === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1beta";
    url.pathname = `${path}/models`.replace(/\/+/g, "/");
  }

  if (api === "anthropic-messages" && !url.searchParams.has("limit")) {
    url.searchParams.set("limit", "1000");
  }
  if (api === "google-generative-ai" && !url.searchParams.has("pageSize")) {
    url.searchParams.set("pageSize", "1000");
  }
  return url;
}
