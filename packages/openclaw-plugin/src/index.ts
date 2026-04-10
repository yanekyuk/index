/**
 * Index Network — OpenClaw plugin entry point.
 *
 * The plugin's current payload is a bootstrap skill under
 * ./skills/openclaw/SKILL.md, discovered by OpenClaw via the `skills`
 * field in openclaw.plugin.json. This file exists to satisfy the
 * full-plugin shape required by OpenClaw (package.json → "openclaw" →
 * "extensions") and is the future home for custom commands, agents,
 * hooks, and extensions.
 */
export default function register(): void {
  // Intentionally empty for now.
}
