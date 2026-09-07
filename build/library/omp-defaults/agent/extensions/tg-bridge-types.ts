/**
 * Ambient type declarations for the Telegram bridge extension.
 *
 * Re-exports all ExtensionAPI types from the installed pi-coding-agent package.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
  ExtensionMode,
  ExtensionHandler,
  ToolCallEvent,
  ToolCallEventResult,
  CustomToolCallEvent,
  TurnStartEvent,
  TurnEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionEndEvent,
  MessageEndEvent,
  TodoReminderEvent,
  AgentStartEvent,
  AgentEndEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "/usr/local/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/types/extensibility/extensions/types";

export type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
  ExtensionMode,
  ExtensionHandler,
  ToolCallEvent,
  ToolCallEventResult,
  CustomToolCallEvent,
  ToolExecutionStartEvent,
  ToolExecutionEndEvent,
  MessageEndEvent,
  TodoReminderEvent,
  AgentStartEvent,
  AgentEndEvent,
  SessionShutdownEvent,
  SessionStartEvent,
};
