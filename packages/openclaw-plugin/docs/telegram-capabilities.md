# Telegram Bot API — Delivery Capabilities

Reference for what the Telegram Bot API supports when sending messages via OpenClaw gateway. Used to inform delivery prompt design and message formatting.

## Text Formatting

Telegram supports two parse modes: **HTML** (recommended) and **MarkdownV2**.

### HTML Tags

| Tag | Effect |
|-----|--------|
| `<b>`, `<strong>` | **Bold** |
| `<i>`, `<em>` | *Italic* |
| `<u>`, `<ins>` | Underline |
| `<s>`, `<strike>`, `<del>` | ~~Strikethrough~~ |
| `<tg-spoiler>` | Spoiler (hidden until tapped) |
| `<code>` | `Inline code` |
| `<pre>` | Code block (optional `language` attr) |
| `<a href="...">` | Hyperlink |
| `<a href="tg://user?id=123">` | User mention (by ID) |
| `<tg-emoji emoji-id="...">` | Custom emoji (Premium bots only) |

Tags can be nested: `<b>bold <i>italic bold</i></b>`.

Special characters `<`, `>`, `&` must be escaped in HTML mode.

### MarkdownV2

Legacy/alternative mode. Uses `*bold*`, `_italic_`, `__underline__`, `~strikethrough~`, `||spoiler||`, `` `code` ``, `[link](url)`. Requires escaping many special characters — HTML mode is generally more predictable.

## Inline Keyboard Buttons

Buttons attached directly below a message. Defined via `reply_markup: InlineKeyboardMarkup` — an array of rows, each row an array of `InlineKeyboardButton` objects.

### Button Action Types

Each button must have exactly one action field (besides `text`, `icon_custom_emoji_id`, `style`):

| Field | Behavior |
|-------|----------|
| `url` | Opens a URL in the user's browser |
| `callback_data` | Sends 1-64 bytes back to the bot (triggers `callback_query`) |
| `web_app` | Launches a Telegram Mini App |
| `login_url` | Auto-authorize via Telegram Login |
| `switch_inline_query` | Opens inline mode in another chat |
| `switch_inline_query_current_chat` | Opens inline mode in current chat |
| `copy_text` | Copies specified text to clipboard |
| `pay` | Payment button (must be first button in first row) |

### Button Styling

Buttons support a `style` field:

- `"primary"` — blue
- `"success"` — green
- `"danger"` — red
- Omitted — app-specific default

### Layout

`InlineKeyboardMarkup.inline_keyboard` is `Array<Array<InlineKeyboardButton>>` — each inner array is one row of buttons. Buttons in the same row appear side by side.

Example structure:
```
Row 1: [ Button A ] [ Button B ]
Row 2: [ Button C ]
```

## Reply Keyboard

Replaces the user's standard keyboard with custom buttons. Buttons send their label text as a message. Can also request contacts, location, polls. Less relevant for our use case (one-shot delivery messages).

## Other Message Types

Beyond `sendMessage`, the bot can send: photos (`sendPhoto`), documents (`sendDocument`), stickers (`sendSticker`), voice (`sendVoice`), video (`sendVideo`), location (`sendLocation`), polls (`sendPoll`), dice (`sendDice`), invoices (`sendInvoice`).

## Message Editing

Sent messages can be edited after the fact via `editMessageText`, `editMessageCaption`, `editMessageReplyMarkup`. This could be used to update button states (e.g., grey out a "Skip" button after it's pressed).

## Constraints

- Message text: 1-4096 characters after entity parsing.
- Caption text: 0-1024 characters.
- `callback_data`: 1-64 bytes.
- Bot must answer callback queries via `answerCallbackQuery` (can show notification/alert or redirect to URL).

## OpenClaw MessagePresentation System

OpenClaw has a channel-agnostic **MessagePresentation** format that gets rendered to native widgets per channel (Telegram inline keyboards, Discord components, Slack Block Kit, etc.).

### Presentation Types

```typescript
type MessagePresentationTone = "neutral" | "info" | "success" | "warning" | "danger";

type MessagePresentation = {
  tone?: MessagePresentationTone;
  title?: string;
  blocks: MessagePresentationBlock[];
};

type MessagePresentationBlock =
  | { type: "text"; text: string }
  | { type: "context"; text: string }
  | { type: "divider" }
  | { type: "buttons"; buttons: MessagePresentationButton[] }
  | { type: "select"; placeholder?: string; options: MessagePresentationOption[] };

type MessagePresentationButton = {
  label: string;
  value?: string;   // callback value (e.g. "cmd:yes") — sent back to agent
  url?: string;      // opens URL in browser — no callback
  style?: "primary" | "secondary" | "success" | "danger";
};
```

### Telegram Rendering

On Telegram, presentation blocks render as:
- `text` / `context` / `divider` → formatted text
- `buttons` → **inline keyboard** (native Telegram buttons below the message)
- `select` → inline keyboard with options

### Button Types

- **URL button** — `{ label: "View Profile", url: "https://index.network/u/123" }` — opens link, no callback
- **Callback button** — `{ label: "Skip", value: "cmd:skip" }` — sends value back to the agent on press

### How to Use Presentations

**CLI:**
```bash
openclaw message send --channel telegram --target @mychat --message "Choose:" \
  --presentation '{"blocks":[{"type":"buttons","buttons":[{"label":"Yes","value":"cmd:yes"}]}]}'
```

**Channel action (JSON):**
```json
{
  "action": "send",
  "channel": "telegram",
  "to": "123456789",
  "message": "Choose an option:",
  "buttons": [
    [{ "text": "Yes", "callback_data": "yes" }],
    [{ "text": "Cancel", "callback_data": "cancel" }]
  ]
}
```

## Relevance to Delivery Dispatcher

### Current Mechanism

The delivery dispatcher (`delivery.dispatcher.ts`) sends messages through OpenClaw's subagent system with `deliver: true`. The subagent `run` API accepts only `message: string` — there is **no `presentation` field** in `SubagentRunOptions`.

### Gap: Subagent Delivery vs. Presentations

The `MessagePresentation` system is available via:
- `openclaw message send --presentation` (CLI)
- Channel-specific send actions (JSON payloads)

But **not** via `api.runtime.subagent.run({ deliver: true })`. The subagent system delivers the LLM's text output as a plain message — it cannot attach inline keyboards or structured blocks.

### What Works Today

- **Markdown formatting** — the Telegram gateway converts Markdown to HTML and sends with `parse_mode: "HTML"`. Use `**bold**`, `_italic_`, `[text](url)`. Do NOT output raw HTML tags — the gateway's Markdown→HTML converter escapes them, so `<b>text</b>` renders literally.
- **Hyperlinks** — `[text](url)` renders as tappable links in Telegram
- **URL buttons via hyperlinks** — profile links, chat links work as inline text links

### What Requires Changes

- **Inline keyboard buttons** (Start Chat, Skip, etc.) — needs either:
  1. Extending `SubagentRunOptions` to accept a `presentation` field (OpenClaw SDK change)
  2. Using `api.runtime.subagent.run` for content generation only, then a separate presentation-aware send mechanism for actual delivery
  3. Having the subagent output a JSON presentation block that the gateway recognizes and parses
