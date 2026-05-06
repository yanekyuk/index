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

/**
 * Reads `welcomeSent` from plugin config. Defaults to `false`;
 * only the literal boolean `true` indicates welcome has been sent.
 *
 * @param api - OpenClaw plugin API instance.
 * @returns `true` if welcome has been sent, `false` otherwise.
 */
export function readWelcomeSent(api: OpenClawPluginApi): boolean {
  const v = api.pluginConfig['welcomeSent'];
  return v === true;
}

/**
 * Writes `welcomeSent = true` to plugin config. Used after successful
 * welcome dispatch to prevent re-sending.
 *
 * @param api - OpenClaw plugin API instance.
 */
export function writeWelcomeSent(api: OpenClawPluginApi): void {
  api.pluginConfig['welcomeSent'] = true;
}
