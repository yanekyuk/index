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
  idempotencyKey: string;
  message: string;
  provider?: string;
  model?: string;
  deliver?: boolean;
}

export interface SubagentRunResult {
  runId: string;
}

export interface WaitForRunOptions {
  runId: string;
  timeoutMs: number;
}

export interface GetSessionMessagesOptions {
  sessionKey: string;
  limit?: number;
}

export interface SessionMessage {
  role: string;
  content: unknown;
}

export interface SubagentRuntime {
  run(options: SubagentRunOptions): Promise<SubagentRunResult>;
  waitForRun(options: WaitForRunOptions): Promise<{ result: unknown }>;
  getSessionMessages(options: GetSessionMessagesOptions): Promise<{ messages: SessionMessage[] }>;
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

/**
 * Narrow slice of OpenClawConfig that the plugin reads at runtime.
 * Matches the shape exposed by `api.config` per the OpenClaw plugin SDK.
 *
 * Only the fields the plugin actively reads are typed here. The real
 * OpenClawConfig has many more fields; treating this as a strict subset
 * keeps the plugin loosely coupled to the SDK's evolving surface.
 */
export interface OpenClawConfigSlice {
  gateway?: {
    port?: number;
    auth?: {
      token?: string;
    };
  };
  /**
   * Hooks subsystem. The plugin requires `hooks.enabled=true` and a
   * non-empty `hooks.token` to dispatch via `POST /hooks/agent`. Setup
   * wizard bootstraps both. See `lib/delivery/main-agent.dispatcher.ts`.
   */
  hooks?: {
    enabled?: boolean;
    path?: string;
    token?: string;
    allowRequestSessionKey?: boolean;
    allowedSessionKeyPrefixes?: string[];
  };
  mcp?: {
    servers?: Record<string, {
      url?: string;
      transport?: string;
      headers?: Record<string, string>;
    }>;
  };
}

export interface CliRegistration {
  (
    factory: (ctx: { program: unknown }) => void | Promise<void>,
    opts?: { descriptors?: Array<{ name: string; description: string; hasSubcommands?: boolean }> },
  ): void;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  pluginConfig: Record<string, unknown>;
  /** Live OpenClaw config snapshot (same shape as `~/.openclaw/openclaw.json`). */
  config?: OpenClawConfigSlice;
  runtime: PluginRuntime;
  logger: PluginLogger;
  registerHttpRoute(options: RouteOptions): void;
  /** Write a value into the OpenClaw config. Available since OpenClaw >=0.1.0. */
  configSet?(path: string, value: unknown): Promise<void>;
  /** Read a value from the OpenClaw config by dot-path (e.g. 'agents.defaults.model'). */
  configGet?(path: string): Promise<unknown>;
  /** Register a CLI subcommand (e.g. `openclaw index-network setup`). */
  registerCli?: CliRegistration;
}

/**
 * Reads the configured default model from OpenClaw's agents.defaults.model.
 * The value can be a plain string or an object with a `primary` key.
 * Returns `undefined` if configGet is unavailable or no model is set.
 */
export async function readModel(api: OpenClawPluginApi): Promise<string | undefined> {
  if (!api.configGet) return undefined;
  const value = await api.configGet('agents.defaults.model').catch(() => undefined);
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && 'primary' in value) {
    const primary = (value as { primary: unknown }).primary;
    return typeof primary === 'string' && primary ? primary : undefined;
  }
  return undefined;
}
