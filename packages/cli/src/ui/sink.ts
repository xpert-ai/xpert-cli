import type { TurnEvent } from "../runtime/turn-events.js";

export interface UiSink {
  readonly interactive: boolean;
  consume(event: TurnEvent): void;
}
