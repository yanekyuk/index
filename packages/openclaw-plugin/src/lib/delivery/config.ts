import type { OpenClawPluginApi } from '../openclaw/plugin-api.js';
import type { MainAgentToolUse } from './main-agent.prompt.js';

/**
 * Reads `mainAgentToolUse` from plugin config. Defaults to `'disabled'`;
 * only the literal string `'enabled'` flips it.
 *
 * @param api - OpenClaw plugin API instance.
 * @returns `'enabled'` or `'disabled'`.
 */
export function readMainAgentToolUse(api: OpenClawPluginApi): MainAgentToolUse {
  const v = api.pluginConfig['mainAgentToolUse'];
  return v === 'enabled' ? 'enabled' : 'disabled';
}

/** Branding fields optionally set in plugin config. */
export interface NodeBranding {
  nodeName: string;
  nodeDescription?: string;
  nodeContext?: string;
}

/**
 * Reads optional branding config from plugin config.
 * Returns `null` when `nodeName` is not set (branding disabled).
 *
 * @param api - OpenClaw plugin API instance.
 * @returns Branding object or null.
 */
export function readNodeBranding(api: OpenClawPluginApi): NodeBranding | null {
  const name = api.pluginConfig['nodeName'];
  if (typeof name !== 'string' || !name.trim()) return null;

  const desc = api.pluginConfig['nodeDescription'];
  const ctx = api.pluginConfig['nodeContext'];

  return {
    nodeName: name.trim(),
    nodeDescription: typeof desc === 'string' && desc.trim() ? desc.trim() : undefined,
    nodeContext: typeof ctx === 'string' && ctx.trim() ? ctx.trim() : undefined,
  };
}
