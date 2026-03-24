export interface InputHistoryController {
  push(value: string): void;
  previous(currentDraft: string): string;
  next(currentDraft: string): string;
  resetBrowsing(): void;
  isBrowsing(): boolean;
}

export function createInputHistoryController(): InputHistoryController {
  const entries: string[] = [];
  let browsingIndex: number | null = null;
  let draftBeforeBrowsing = "";

  return {
    push(value) {
      const normalized = value.trim();
      browsingIndex = null;
      draftBeforeBrowsing = "";

      if (!normalized) {
        return;
      }

      if (entries[entries.length - 1] === normalized) {
        return;
      }

      entries.push(normalized);
    },
    previous(currentDraft) {
      if (entries.length === 0) {
        return currentDraft;
      }

      if (browsingIndex === null) {
        draftBeforeBrowsing = currentDraft;
        browsingIndex = entries.length - 1;
        return entries[browsingIndex] ?? currentDraft;
      }

      browsingIndex = Math.max(0, browsingIndex - 1);
      return entries[browsingIndex] ?? currentDraft;
    },
    next(currentDraft) {
      if (browsingIndex === null) {
        return currentDraft;
      }

      if (browsingIndex >= entries.length - 1) {
        const draft = draftBeforeBrowsing;
        browsingIndex = null;
        draftBeforeBrowsing = "";
        return draft;
      }

      browsingIndex += 1;
      return entries[browsingIndex] ?? currentDraft;
    },
    resetBrowsing() {
      browsingIndex = null;
      draftBeforeBrowsing = "";
    },
    isBrowsing() {
      return browsingIndex !== null;
    },
  };
}
