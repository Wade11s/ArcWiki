export type ReadingWidth = "comfortable" | "wide";

export type ApiKeySource = "none" | "saved" | "environment";

export type SettingsGroupId = "agent" | "reading";

export type PublicSettings = {
  agent: {
    apiKeySource: ApiKeySource;
    baseUrl: string;
    model: string;
  };
  reading: {
    width: ReadingWidth;
  };
};

export type SaveSettingsInput = {
  apiKey?: string;
  clearApiKey?: boolean;
  baseUrl?: string;
  model?: string;
  readingWidth?: ReadingWidth;
};

export type SettingsChanged = {
  readingWidth: ReadingWidth;
  agentChanged: boolean;
  agentConfigured: boolean;
};
