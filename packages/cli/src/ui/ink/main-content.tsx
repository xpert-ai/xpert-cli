import type { UiRenderBlock } from "../render-blocks.js";
import { Box } from "ink";
import { BlockView } from "./blocks.js";

export function MainContent(props: {
  width: number;
  blocks: UiRenderBlock[];
}) {
  if (props.blocks.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" width={props.width}>
      {props.blocks.map((block) => (
        <BlockView key={block.id} block={block} width={props.width} />
      ))}
    </Box>
  );
}
