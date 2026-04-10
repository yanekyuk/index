/**
 * Minimal type shape for the subset of OpenClawPluginApi we depend on.
 * If/when we import real types from @openclaw/plugin-sdk, replace these
 * with re-exports. Keeping this file thin lets us unit-test the plugin
 * without pulling in the SDK runtime.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface PluginLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface SubagentRunOptions {
  sessionKey: string;
  message: string;
  provider?: string;
  model?: string;
  deliver?: boolean;
}

export interface SubagentRunResult {
  runId: string;
}

export interface SubagentRuntime {
  run(options: SubagentRunOptions): Promise<SubagentRunResult>;
}

export interface PluginRuntime {
  subagent: SubagentRuntime;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean> | boolean;

export interface RouteOptions {
  path: string;
  auth: 'gateway' | 'plugin';
  match?: 'exact' | 'prefix';
  replaceExisting?: boolean;
  handler: RouteHandler;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  pluginConfig: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  registerHttpRoute(options: RouteOptions): void;
}
