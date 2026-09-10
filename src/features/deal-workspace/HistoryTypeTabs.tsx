import type React from "react";
import { PILL_TAB, Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HistoryFeed } from "@/features/deal-workspace/HistoryFeed";
import { historyTabLabel } from "@/features/deal-workspace/historyTabCounts";
import type { HistoryItem } from "@/features/deal-workspace/historyTimeline";
import type { DraftSummary } from "@/features/email/draftRepo";
import type { EmailCardScope } from "@/features/email/EmailTimelineCard";
import { FileAttachments } from "@/features/files/FileAttachments";
import { DealProductsPanel } from "@/features/products/DealProductsPanel";

export type HistoryTab =
  | "all"
  | "activities"
  | "notes"
  | "email"
  | "files"
  | "products"
  | "changelog";

const TAB_LABELS: Record<HistoryTab, string> = {
  all: "Todos",
  activities: "Atividades",
  notes: "Notas",
  email: "Email",
  files: "Arquivos",
  products: "Produtos",
  changelog: "Histórico de alterações",
};

const EMPTY_LABELS: Partial<Record<HistoryTab, string>> = {
  all: "Ainda não há histórico.",
  activities: "Ainda não há atividades.",
  notes: "Ainda não há notas.",
  changelog: "Ainda não há alterações registradas.",
  email: "Ainda não há emails vinculados a este negócio.",
};

const TABS: HistoryTab[] = [
  "all",
  "activities",
  "notes",
  "email",
  "files",
  "products",
  "changelog",
];

interface HistoryTypeTabsProps {
  tab: HistoryTab;
  onTab: (t: HistoryTab) => void;
  counts: Partial<Record<HistoryTab, number>>;
  items: Record<HistoryTab, HistoryItem[]>;
  dealId: string;
  onActivityChanged?: () => void;
  // Forwarded to the nested HistoryFeed; not yet wired to a note-level control (Task 6).
  onNoteChanged?: () => void;
  // Open an activity in the inline edit composer.
  onEditActivity?: (activityId: string) => void;
  // Which record's timeline this is, for the email cards' unlink and reply.
  emailScope?: EmailCardScope;
  // Overrides the Email tab's empty line while the linked-message read is loading or failed, so a
  // pending or broken read never reads as "no emails linked".
  emailEmptyLabel?: string;
  // Refetch the record's linked messages after an unlink or a sent reply.
  onEmailChanged?: () => void;
  // Open one of the record's unsent drafts in the host's composer.
  onResumeDraft?: (draft: DraftSummary) => void;
  // Refetch the record's drafts after one is discarded.
  onDraftChanged?: () => void;
}

// The per-type filter row that used to be the entire "History" tab bar (Wave
// 3, Task 17: now nested under the History side of the Focus/History switch,
// filtering the History bucket instead of the raw activities/notes/changelog).
export function HistoryTypeTabs({
  tab,
  onTab,
  counts,
  items,
  dealId,
  onActivityChanged,
  onNoteChanged,
  onEditActivity,
  emailScope,
  emailEmptyLabel,
  onEmailChanged,
  onResumeDraft,
  onDraftChanged,
}: HistoryTypeTabsProps): React.ReactNode {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as HistoryTab)}>
      <TabsList className="flex-wrap gap-1">
        {TABS.map((t) => (
          <TabsTrigger key={t} value={t} className={PILL_TAB}>
            {historyTabLabel(TAB_LABELS[t], counts[t])}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="pt-4">
        {/* History is a view of what is attached, not a compose surface: read-only so the
            deal page shows one uploader (the compose bar's Files tab), not two. */}
        {tab === "files" && <FileAttachments entityType="deal" entityId={dealId} readOnly />}
        {tab === "products" && <DealProductsPanel dealId={dealId} />}
        {tab !== "files" && tab !== "products" && (
          <HistoryFeed
            items={items[tab]}
            emptyLabel={
              (tab === "email" ? emailEmptyLabel : undefined) ??
              EMPTY_LABELS[tab] ??
              "Ainda não há histórico."
            }
            onActivityChanged={onActivityChanged}
            onNoteChanged={onNoteChanged}
            onEditActivity={onEditActivity}
            emailScope={emailScope}
            onEmailChanged={onEmailChanged}
            onResumeDraft={onResumeDraft}
            onDraftChanged={onDraftChanged}
          />
        )}
      </div>
    </Tabs>
  );
}
