import { Box, Text } from "ink";

export function Composer(props: {
  value: string;
  turnState: "idle" | "running" | "waiting_permission";
}) {
  if (props.turnState === "running") {
    return (
      <Box marginTop={1}>
        <Text dimColor>running... Press Ctrl+C to cancel, twice to exit.</Text>
      </Box>
    );
  }

  if (props.turnState === "waiting_permission") {
    return (
      <Box marginTop={1}>
        <Text dimColor>waiting for permission response... Press Ctrl+C to cancel.</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <Text color="cyan">xpert&gt; </Text>
      {props.value ? (
        <Text>{props.value}</Text>
      ) : (
        <Text dimColor>/status /tools /session /exit | Up/Down history</Text>
      )}
      <Text>█</Text>
    </Box>
  );
}
