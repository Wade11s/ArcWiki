import {
  Agent,
  OpenAIChatCompletionsModel,
  Runner,
  setTracingDisabled,
  type AgentInputItem,
} from "@openai/agents";
import OpenAI from "openai";
import { HttpError, httpError, sanitizeMessage } from "./errors";
import type { ChatMessage, ChatResponder } from "./types";

setTracingDisabled(true);

export type OpenRouterAgentOptions = {
  apiKey: string;
  baseURL: string;
  model: string;
};

export function toAgentInput(messages: ChatMessage[]): AgentInputItem[] {
  return messages.map((message) => {
    if (message.role === "user") {
      return {
        type: "message",
        role: "user",
        content: message.content,
      };
    }
    return {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: message.content }],
    };
  });
}

function describeUpstreamError(err: unknown, secrets: string[]): string {
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: number }).status)
      : undefined;

  if (status === 401 || status === 403) {
    return "OpenRouter rejected the request. Check that the API key in Settings is valid.";
  }
  if (status === 404) {
    return "OpenRouter could not find the requested model.";
  }
  if (status === 429) {
    return "OpenRouter rate-limited the request. Try again shortly.";
  }

  const raw = err instanceof Error ? err.message : "The model request failed.";
  const sanitized = sanitizeMessage(raw, secrets)
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .trim();

  if (sanitized.length === 0) {
    return "The model request failed.";
  }
  if (sanitized.length > 400) {
    return `${sanitized.slice(0, 400)}…`;
  }
  return sanitized;
}

export function createOpenRouterResponder(
  options: OpenRouterAgentOptions,
): ChatResponder {
  // Chat Completions adapter — not the Responses API.
  const model = new OpenAIChatCompletionsModel(
    new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    }),
    options.model,
  );
  const agent = new Agent({
    name: "ArcWiki",
    instructions:
      "You are ArcWiki's assistant. Be helpful, precise, and concise.",
    model,
  });
  const runner = new Runner({ tracingDisabled: true });
  const secrets = [options.apiKey];

  return async (messages, signal) => {
    try {
      const result = await runner.run(agent, toAgentInput(messages), {
        signal,
      });
      const text =
        typeof result.finalOutput === "string" ? result.finalOutput.trim() : "";
      if (!text) {
        throw httpError(
          502,
          "empty_response",
          "The model returned an empty response.",
        );
      }
      return text;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (signal?.aborted) throw err;
      throw httpError(502, "upstream", describeUpstreamError(err, secrets));
    }
  };
}
