import { Box, Static } from "ink";
import type { PendingTurnState, UiHistoryItem } from "../history.js";
import { HistoryItemView, PendingTurnView } from "./history-item.js";

export function MainContent(props: {
  history: UiHistoryItem[];
  pending: PendingTurnState;
}) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Static items={props.history}>
        {(item) => <HistoryItemView key={item.id} item={item} />}
      </Static>
      <PendingTurnView pending={props.pending} />
    </Box>
  );
}
