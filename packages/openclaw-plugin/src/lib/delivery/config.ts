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
