export type WikiConnection = { port: number; token: string };

export type WikiSpace = {
  id: string;
  name: string;
  purpose?: string;
};

export type WikiSource = {
  id: string;
  kind: "markdown" | "url" | "pdf";
  title: string;
  origin: string;
  finalUrl?: string;
  pageCount?: number;
  warnings: string[];
  spaceId: string | null;
  createdAt: string;
};

export type WikiPage = {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  sourceIds: string[];
  updatedAt: string;
};

export type WikiSpaceContent = {
  sources: WikiSource[];
  pages: WikiPage[];
};

export type WikiSuggestion = {
  space: WikiSpace;
  score: number;
  matchedTerms: string[];
};

export type WikiQueryResult = {
  kind: "page" | "source";
  id: string;
  title: string;
  snippet: string;
  citation: string;
};

export async function wikiRequest<T>(
  connection: WikiConnection,
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${connection.port}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${connection.token}`,
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json() as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(data.error?.message ?? "The Wiki request failed.");
  }
  return data;
}
