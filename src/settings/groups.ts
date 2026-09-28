import type { SettingsGroupId } from "./types";

export type SettingsGroup = {
  id: SettingsGroupId;
  title: string;
  description: string;
};

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "profile",
    title: "Profile",
    description: "How you appear in Agent Threads.",
  },
  {
    id: "agent",
    title: "Agent",
    description: "Model provider used by Agent Threads.",
  },
  {
    id: "reading",
    title: "Reading",
    description: "How Markdown pages are laid out.",
  },
];
