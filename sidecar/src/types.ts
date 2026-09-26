export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatResponder = (
  messages: ChatMessage[],
  signal?: AbortSignal,
) => Promise<string>;

export type ErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export type HealthBody = {
  ok: true;
  configured: boolean;
};

export type ChatSuccessBody = {
  text: string;
};
