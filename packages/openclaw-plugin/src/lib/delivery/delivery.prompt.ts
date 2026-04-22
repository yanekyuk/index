export function deliveryPrompt(rendered: {
  headline: string;
  body: string;
}): string {
  return [
    'You are delivering a message to the user via their active OpenClaw gateway.',
    'The content below was prepared by Index Network. Relay it faithfully — preserve substance, format for the gateway (concise, chat-friendly).',
    'Do not summarize, rewrite, or add your own commentary. Do not ask the user for input.',
    '',
    `# ${rendered.headline}`,
    '',
    rendered.body,
  ].join('\n');
}
