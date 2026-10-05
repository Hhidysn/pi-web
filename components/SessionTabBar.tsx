"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionActivityStatus } from "@/lib/session-status";

export interface SessionTabItem {
  id: string;
  label: string;
  status: SessionActivityStatus;
}

interface Props {
  tabs: SessionTabItem[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onReorderTab: (from: number, to: number) => void;
}

/**
 * Status marker of one conversation tab: a spinner while the agent runs, a
 * green check for a completion the user has not looked at yet, and nothing for
 * an idle conversation. The idle slot keeps its width so labels stay aligned.
 */
function TabStatusMarker({ status }: { status: SessionActivityStatus }) {
  const { t } = useI18n();
  if (status === "idle") return <span style={{ width: 11, flexShrink: 0 }} aria-hidden="true" />;
  const running = status === "running";
  return (
    <span
      title={t(running ? "tabs.statusRunning" : "tabs.statusDone")}
      aria-label={t(running ? "tabs.statusRunning" : "tabs.statusDone")}
      style={{
        width: 11,
        height: 11,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: running ? "var(--accent)" : "#16a34a",
      }}
    >
      {running ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
          <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
          </path>
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ display: "block" }}>
          <circle cx="6" cy="6" r="5" fill="currentColor" opacity="0.18" />
          <polyline points="3.6 6.2 5.2 7.8 8.4 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/**
 * Conversation tabs above the chat area. One tab per open conversation, from
 * any project; switching tabs only changes which chat pane is visible, so a
 * running conversation keeps streaming in the background.
 *
 * Order is the open order and can be changed by dragging. The active tab
 * scrolls into view when it changes (keyboard or sidebar selection).
 */
export function SessionTabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onReorderTab }: Props) {
  const { t } = useI18n();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={t("tabs.openConversations")}
      style={{
        display: "flex",
        alignItems: "flex-end",
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
        overflowX: "auto",
        flexShrink: 0,
        height: 36,
      }}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        // With the composer shown no tab is active; the first one stays
        // focusable so the strip is still reachable from the keyboard.
        const isTabStop = isActive || (activeTabId === null && index === 0);
        return (
          <div
            key={tab.id}
            ref={isActive ? activeTabRef : undefined}
            id={`session-tab-${tab.id}`}
            role="tab"
            aria-selected={isActive}
            aria-controls={`session-pane-${tab.id}`}
            aria-label={tab.label}
            tabIndex={isTabStop ? 0 : -1}
            draggable
            title={tab.label}
            onDragStart={(event) => {
              setDragIndex(index);
              event.dataTransfer.effectAllowed = "move";
              // Firefox requires data to be set for a drag to start.
              event.dataTransfer.setData("text/plain", tab.id);
            }}
            onDragOver={(event) => {
              if (dragIndex === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropIndex(index);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setDropIndex(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex !== null && dragIndex !== index) onReorderTab(dragIndex, index);
              setDragIndex(null);
              setDropIndex(null);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                onSelectTab(tabs[next].id);
                (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
              }
            }}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              event.stopPropagation();
              onCloseTab(tab.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              paddingLeft: 12,
              paddingRight: 6,
              borderRight: "1px solid var(--border)",
              background: isActive ? "var(--bg)" : "var(--bg-panel)",
              cursor: "pointer",
              fontSize: 12,
              color: isActive ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 200,
              minWidth: 92,
              flexShrink: 0,
              userSelect: "none",
              transition: "background 0.1s, color 0.1s",
              // Highlight the drop target while dragging another tab over it.
              boxShadow: dropIndex === index && dragIndex !== null && dragIndex !== index
                ? "inset 2px 0 0 var(--accent)"
                : undefined,
              opacity: dragIndex === index ? 0.6 : 1,
            }}
          >
            <TabStatusMarker status={tab.status} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1, fontWeight: isActive ? 500 : 400 }}>
              {tab.label}
            </span>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              title={t("tabs.closeSession")}
              aria-label={`${t("tabs.closeSession")}: ${tab.label}`}
              tabIndex={-1}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                padding: 0,
                border: "none",
                borderRadius: 4,
                background: hoveredClose === tab.id ? "var(--bg-hover)" : "none",
                color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" /><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
