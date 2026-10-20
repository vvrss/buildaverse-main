# Storyteller

A private, offline writing app for stories told mostly through dialog. Writing feels like a chat: one character per bubble, with narration in between. Switching who speaks costs almost nothing.

It runs entirely in the browser. Stories are saved on your device in IndexedDB, with no account and no server. You can install it to your phone's home screen (it's a PWA). It is separate from the Buildaverse Laravel app in the rest of this repo.

## Writing fast

- **Enter sends the line and switches to the other speaker** of the current exchange. A two-person scene needs no manual switching at all. Use **Shift+Enter** to keep the same speaker.
- **Shortcut bar on top of the keyboard.** It stays pinned right above the on-screen keyboard on iOS and Android.
  - **Swipe the character chips** left or right to change speaker. A longer swipe skips several.
  - Tap a chip to pick it directly.
  - **‹ ›** step back and forth through the lines. The selected line opens in the composer for editing.
  - **↶** undoes.
  - **Swipe up** on the chips, or tap **✍**, to open the gesture pad.
- **Drawn gestures.** Draw a symbol with your finger on the gesture pad:
  - `<` previous line
  - `>` next line
  - `Z` undo
  - `○` narration
  - `—` heading

  Record your own under **Shortcuts & gestures**: pick an action (for example "Switch to Ana"), draw it 3 times, and save. Recognition is a small $1-recognizer variant that runs on the device. It cares about orientation, so `<` and `>` stay distinct.
- **Typed prefixes**:
  - `@ana` switches speaker. An unknown name creates a new character.
  - `>` narration, `# ` heading, `//` note.
  - `(whispering)` adds a stage direction.
  - `/u` undo, `/r` redo, `/b` back, `/f` forward, … (type `/` to see the list).
- **Desktop hotkeys**:
  - `Tab` / `Shift+Tab`: next / previous character
  - `Alt+1…9`: pick a character
  - `Ctrl+↑/↓`: previous / next line
  - `Ctrl+Z`: undo
  - `Alt+G`: gesture pad

  The full list is in the app.

## Editing with AI

Every story is plain text in the [`.story` format](FORMAT.md).

- **Text** tab: edit that text directly.
- **AI** tab: copy the story with a format reminder for ChatGPT, Claude, or any other AI, then paste the answer back. You'll see what changed before you apply it.

## Development

```bash
cd storyteller
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (format, auto-alternate, prefixes, gesture recognizer)
npm run e2e        # Playwright, phone viewport (builds and serves on :4173)
npm run build      # type-check + production build into dist/ (static files, host anywhere)
```

Stack: Vite, TypeScript, Preact with signals, vite-plugin-pwa. The only runtime dependencies are `preact` and `@preact/signals`.

```
src/format/     .story parser, serializer, diff, AI helpers
src/store/      IndexedDB, undo history, editor state, auto-alternate logic
src/shortcuts/  action registry, hotkeys, prefixes, keyboard bar, viewport tracking
src/gestures/   recognizer, built-in gestures, pad, recording UI
src/views/      library, editor, text mode, cast, AI exchange
```
