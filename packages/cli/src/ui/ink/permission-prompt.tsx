import { Box, Text } from "ink";
import type { InlinePermissionState } from "../inline-permission.js";

export function PermissionPrompt(props: {
  state: InlinePermissionState;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">Permission required</Text>
      <Text>{props.state.message}</Text>
      {props.state.choices.map((choice, index) => (
        <Text key={choice.title} color={index === props.state.selectedIndex ? "green" : undefined}>
          {index === props.state.selectedIndex ? "> " : "  "}
          {choice.title}
        </Text>
      ))}
      <Text dimColor>Use up/down and Enter. Esc denies.</Text>
    </Box>
  );
}
