import { MAX_CONTENT_CHARS, MAX_MESSAGES } from "./constants";
import { httpError } from "./errors";
import type { ChatMessage } from "./types";

function invalidRequest(message: string) {
  return httpError(400, "invalid_request", message);
}

export function parseChatMessages(body: unknown): ChatMessage[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalidRequest("Request body must be a JSON object.");
  }

  if (!Object.prototype.hasOwnProperty.call(body, "messages")) {
    throw invalidRequest('Missing required "messages" array.');
  }

  const { messages } = body as { messages: unknown };
  if (!Array.isArray(messages)) {
    throw invalidRequest('"messages" must be an array.');
  }
  if (messages.length === 0) {
    throw invalidRequest('"messages" must contain at least one message.');
  }
  if (messages.length > MAX_MESSAGES) {
    throw invalidRequest(
      `"messages" must contain at most ${MAX_MESSAGES} items.`,
    );
  }

  const parsed: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const item = messages[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw invalidRequest(`messages[${i}] must be an object.`);
    }

    const record = item as { role?: unknown; content?: unknown };
    if (record.role !== "user" && record.role !== "assistant") {
      throw invalidRequest(
        `messages[${i}].role must be "user" or "assistant".`,
      );
    }
    if (typeof record.content !== "string") {
      throw invalidRequest(`messages[${i}].content must be a string.`);
    }
    if (record.content.length > MAX_CONTENT_CHARS) {
      throw invalidRequest(
        `messages[${i}].content exceeds ${MAX_CONTENT_CHARS} characters.`,
      );
    }

    parsed.push({ role: record.role, content: record.content });
  }

  return parsed;
}
