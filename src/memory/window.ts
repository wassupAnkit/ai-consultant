import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { StoredMessage } from "./store";

/**
 * Convert stored history into LangChain messages, keeping the most recent
 * `maxMessages` and trimming very long turns so the prompt stays bounded.
 */
export function toWindowedMessages(
  history: StoredMessage[],
  maxMessages: number,
  maxCharsPerMessage = 3_000,
): BaseMessage[] {
  return history.slice(-maxMessages).map((m) => {
    const content =
      m.content.length > maxCharsPerMessage ? m.content.slice(0, maxCharsPerMessage) + " …" : m.content;
    return m.role === "human" ? new HumanMessage(content) : new AIMessage(content);
  });
}
