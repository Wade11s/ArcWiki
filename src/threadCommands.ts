export const THREAD_COMMANDS = [
  { name: "ingest", description: "Capture Markdown, PDF or a public URL, then confirm its Space." },
  { name: "wiki", description: "Maintain Pages, search this Space and check its citations." },
  { name: "help", description: "Show local Thread commands." },
] as const;

export type ThreadCommand = {
  name: (typeof THREAD_COMMANDS)[number]["name"];
  initialUrl?: string;
};

/** Commands are local UI actions, never provider messages or model-selected tools. */
export function parseThreadCommand(input: string):
  | { command: ThreadCommand }
  | { error: string }
  | null {
  const text = input.trim();
  if (!text.startsWith("/")) return null;
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text);
  const name = match?.[1].toLowerCase();
  const argument = match?.[2]?.trim();
  if (name === "ingest") {
    if (!argument) return { command: { name } };
    try {
      const url = new URL(argument);
      if (!/^https?:\/\/\S+$/i.test(argument) || !["http:", "https:"].includes(url.protocol) ||
        url.username || url.password) throw new Error();
      return { command: { name, initialUrl: argument } };
    } catch {
      return { error: "Use /ingest to choose a Markdown or PDF file, or /ingest https://example.com/article." };
    }
  }
  if (name === "wiki" || name === "help") {
    return argument
      ? { error: `/${name} does not take arguments.` }
      : { command: { name } };
  }
  return { error: "Unknown Thread command. Use /ingest, /wiki or /help." };
}
