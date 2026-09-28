export type ReadingWidth = "comfortable" | "wide";

export type ApiKeySource = "none" | "saved" | "environment";

export type SettingsGroupId = "profile" | "agent" | "reading";

export type PublicSettings = {
  profile: {
    displayName: string;
    avatarDataUrl: string | null;
  };
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
  displayName?: string;
  avatarDataUrl?: string;
  clearAvatar?: boolean;
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
  displayName: string;
  profileChanged: boolean;
};
