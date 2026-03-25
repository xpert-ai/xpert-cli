import type { InspectorPanelData } from "../commands.js";
import type {
  TranscriptViewportMetrics,
  TranscriptViewportState,
} from "../transcript-viewport.js";
import { buildOverlayRenderBlocks } from "../render-blocks.js";
import { Pager } from "./pager.js";

export function Overlay(props: {
  width: number;
  height: number;
  data: InspectorPanelData;
  viewport: TranscriptViewportState;
  focused: boolean;
  onViewportMetrics: (metrics: TranscriptViewportMetrics) => void;
}) {
  return (
    <Pager
      width={props.width}
      height={props.height}
      title={props.data.title}
      blocks={buildOverlayRenderBlocks(props.data)}
      viewport={props.viewport}
      focused={props.focused}
      emptyLabel="(empty overlay)"
      onViewportMetrics={props.onViewportMetrics}
    />
  );
}
