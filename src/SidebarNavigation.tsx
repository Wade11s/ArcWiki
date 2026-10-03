import { useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronRight, FileText, Hash, House, MessageCircle, Plus, X } from "lucide-react";

export type SidebarItem = {
  id: string;
  title: string;
  kind: "page" | "topic" | "thread";
  current: boolean;
  local?: boolean;
  imported?: boolean;
  onSelect: () => void;
  onClose?: () => void;
  closeDisabled?: boolean;
};

type SidebarProps = {
  spaceId: string;
  spaceName: string;
  homeCurrent: boolean;
  items: SidebarItem[];
  onHome: () => void;
  onNewThread: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

const GROUPS = [
  { kind: "page", label: "Pages", empty: "No pages yet" },
  { kind: "topic", label: "Topics", empty: "No topics yet" },
  { kind: "thread", label: "Agent Threads", empty: "No agent threads yet" },
] as const;

export function SidebarNavigation({
  spaceId,
  spaceName,
  homeCurrent,
  items,
  onHome,
  onNewThread,
  onKeyDown,
}: SidebarProps) {
  // Folding is presentation-only and independent for each Space.
  const [collapsedBySpace, setCollapsedBySpace] = useState<
    Record<string, Partial<Record<SidebarItem["kind"], boolean>>>
  >({});

  function setCollapsed(kind: SidebarItem["kind"], collapsed: boolean) {
    setCollapsedBySpace((current) => ({
      ...current,
      [spaceId]: { ...current[spaceId], [kind]: collapsed },
    }));
  }

  return (
    <>
      <nav className="sidebar-pins" aria-label={`Pinned in ${spaceName}`}>
        <div className="section-heading">
          <span className="section-title">PIN</span>
        </div>
        <div className={`tab-row ${homeCurrent ? "is-current" : ""}`}>
          <button
            className="tab-button"
            type="button"
            aria-label="Home Page"
            aria-current={homeCurrent ? "page" : undefined}
            onClick={onHome}
          >
            <span className="tab-icon"><House aria-hidden="true" /></span>
            <span className="tab-title">Home Page</span>
          </button>
        </div>
        <button
          className="side-action pinned-thread-action"
          type="button"
          aria-label="Add Agent Thread"
          onClick={() => {
            setCollapsed("thread", false);
            onNewThread();
          }}
        >
          <span className="tab-icon"><MessageCircle aria-hidden="true" /></span>
          <span>Add Agent Thread</span>
          <Plus aria-hidden="true" />
        </button>
      </nav>

      <nav
        className="sidebar-tab-groups"
        aria-label={`Tabs in ${spaceName}`}
        onKeyDown={onKeyDown}
      >
        {GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.kind === group.kind);
          const collapsed = collapsedBySpace[spaceId]?.[group.kind] ?? false;
          const groupId = `sidebar-${group.kind}-tabs`;
          return (
            <section className="sidebar-tab-group" key={group.kind}>
              <button
                className="tab-group-heading"
                type="button"
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.label}`}
                aria-expanded={!collapsed}
                aria-controls={groupId}
                onClick={() => setCollapsed(group.kind, !collapsed)}
              >
                <span>{group.label}</span>
                <span className="tab-count">{groupItems.length}</span>
                <ChevronRight
                  className={`group-chevron ${collapsed ? "" : "is-expanded"}`}
                  aria-hidden="true"
                />
              </button>
              <div className="tab-list" id={groupId} hidden={collapsed}>
                {groupItems.length === 0 && (
                  <p className="tab-group-empty">{group.empty}</p>
                )}
                {groupItems.map((item) => (
                  <div
                    className={`tab-row ${item.current ? "is-current" : ""}`}
                    key={item.id}
                  >
                    <button
                      type="button"
                      className="tab-button"
                      data-tab-button
                      aria-label={item.title}
                      aria-current={item.current ? "page" : undefined}
                      onClick={item.onSelect}
                      title={item.local ? `${item.title} · Local tab, not Wiki knowledge` : item.title}
                    >
                      <span className={`tab-icon ${item.kind === "thread" ? "is-thread" : ""}`}>
                        {item.kind === "thread" ? <MessageCircle aria-hidden="true" />
                          : item.kind === "topic" ? <Hash aria-hidden="true" />
                            : <FileText aria-hidden="true" />}
                      </span>
                      <span className="tab-title">{item.title}</span>
                      {item.local && <span className="local-tab-badge">Local</span>}
                      {item.imported && (
                        <span className="import-indicator" title="Imported file">
                          <Check aria-hidden="true" />
                        </span>
                      )}
                    </button>
                    {item.onClose && (
                      <button
                        type="button"
                        className="tab-close"
                        aria-label={`Close ${item.title}`}
                        title={item.closeDisabled ? "Keep at least one tab in this Space" : `Close ${item.title}`}
                        disabled={item.closeDisabled}
                        onClick={item.onClose}
                      >
                        <X aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </nav>
    </>
  );
}
