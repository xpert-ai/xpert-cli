import type { PermissionRequest } from "@xpert-cli/contracts";
import { createAbortError } from "../runtime/turn-control.js";
import {
  buildPermissionMessage,
  buildPermissionPromptChoices,
  type PermissionPromptChoice,
  type PermissionPromptResult,
} from "./permission.js";

export interface InlinePermissionState {
  message: string;
  choices: PermissionPromptChoice[];
  selectedIndex: number;
}

type Listener = (state: InlinePermissionState | null) => void;

export class InlinePermissionController {
  #state: InlinePermissionState | null = null;
  #listeners = new Set<Listener>();
  #resolve?: (result: PermissionPromptResult) => void;
  #reject?: (error: Error) => void;
  #abortSignal?: AbortSignal;
  #abortListener?: () => void;

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  getState(): InlinePermissionState | null {
    return this.#state;
  }

  request(
    request: PermissionRequest,
    signal?: AbortSignal,
  ): Promise<PermissionPromptResult> {
    if (this.#state) {
      return Promise.reject(new Error("A permission prompt is already active"));
    }

    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    this.#state = {
      message: buildPermissionMessage(request),
      choices: buildPermissionPromptChoices(request),
      selectedIndex:
        request.riskLevel === "dangerous"
          ? Math.min(
              buildPermissionPromptChoices(request).length - 1,
              1,
            )
          : 0,
    };
    this.#notify();

    return new Promise<PermissionPromptResult>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;

      if (signal) {
        this.#abortSignal = signal;
        this.#abortListener = () => {
          this.#finish();
          reject(createAbortError());
        };
        signal.addEventListener("abort", this.#abortListener, { once: true });
      }
    });
  }

  moveSelection(delta: number): void {
    if (!this.#state) {
      return;
    }

    const nextIndex =
      (this.#state.selectedIndex + delta + this.#state.choices.length) %
      this.#state.choices.length;

    this.#state = {
      ...this.#state,
      selectedIndex: nextIndex,
    };
    this.#notify();
  }

  submitSelection(): void {
    if (!this.#state || !this.#resolve) {
      return;
    }

    const choice = this.#state.choices[this.#state.selectedIndex];
    if (!choice) {
      this.#resolve({ outcome: "deny" });
      this.#finish();
      return;
    }
    this.#resolve({ outcome: choice.outcome });
    this.#finish();
  }

  denySelection(): void {
    if (!this.#resolve) {
      return;
    }

    this.#resolve({ outcome: "deny" });
    this.#finish();
  }

  #finish(): void {
    if (this.#abortSignal && this.#abortListener) {
      this.#abortSignal.removeEventListener("abort", this.#abortListener);
    }

    this.#abortSignal = undefined;
    this.#abortListener = undefined;
    this.#resolve = undefined;
    this.#reject = undefined;
    this.#state = null;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
