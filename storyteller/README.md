# Storyteller

A writing app for stories told mostly through dialog, with a Community to publish them in. Writing feels like a chat: one character per bubble, with narration and pictures in between. Switching who speaks costs almost nothing.

Writing works entirely in the browser and offline. Stories and pictures are saved on your device in IndexedDB, and you can install the app to your phone's home screen (it's a PWA). Publishing to the **Community** is optional and needs the Storyteller server in [`server/`](server), which also serves the app ([DEPLOY.md](DEPLOY.md)). Without a server, everything except the Community works. It is separate from the Buildaverse Laravel app in the rest of this repo.

## The app

- **Profiles** are the people on this device. Each one has a name, a color and an optional 4-digit PIN lock. Several people can share a device, and each person sees only their own stories, pictures, gestures and settings. A profile can sign in to its own **Community account**; a backup file moves a profile's stories to another device. The PIN keeps people out of the app, but the stories are not encrypted.
- **Stories home**: a quiet list of your stories with their covers and first lines, plus search, sorting, rename, duplicate, export and delete (each delete asks first).
- **Read** a story back line by line, like song lyrics: press ▶ in the editor (or Read in a story's menu). One line is lit at a time, the rest are dimmed, and the page glides up to the next line at a reading pace (Slow, Calm or Quick). Tap a line to jump to it, tap the lit one to move on, use the arrow keys and Space, or just scroll: scrolling pauses and lights the line you stop at. The background takes the color of the story's cover or first character. Community episodes are read the same way.
- **Export** any story:
  - as a `.story` file
  - as a Markdown script
  - printed, or saved as a PDF, in a play-script layout
  - copied to the clipboard
  - shared to another app, on phones that support it

  **Full backup** saves a profile's stories, gestures and settings in one JSON file, with its pictures if you like. Restoring one adds stories and never overwrites any.
- **Pictures**: add one with the picture button, `/p`, `Alt+P`, a gesture, or by pasting or dropping it. Give characters a **portrait** (shown beside their bubbles) and a story a **cover** in the Cast tab, with a crop step. Pictures are shrunk on the device (at most 1600 px, AVIF/WebP/JPEG), turned upright and stripped of camera and GPS data before they are stored, and they work offline.
- **Settings**:
  - **Appearance**: theme (system, light, dark), text size, chat side for the first character, show notes
  - **Writing**: auto-switch speaker, Enter sends, swipe direction, vibration
  - **Reading**: how quickly lines move on when a story plays
  - **Gestures**: recognition strictness
  - **Data**: backup and restore, how much storage is used, protecting stories from browser cleanup
  - **App**: install, updates, version
- **Updates** wait until you choose to reload, so a new version never interrupts a sentence.

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
  - `Alt+P`: add a picture

  The full list is in the app.

## Community

Open the **Community** tab to read what others published: **Discover** (search, genres, tags, new or popular), **Following** (new episodes of the stories and writers you follow) and **Reading** (pick up where you left off).

- A published **story** holds **chapters**, and each chapter holds **episodes**. One story on your device is one episode.
- **Publish** from a story's Export sheet: sign in or create an account (username and password, no email), choose the story and chapter, and see what stays private first: `//` notes and extra header lines never leave the device. Pictures upload once and are reused; an interrupted publish can simply be retried.
- **Update** an episode the same way. If it changed online meanwhile (from another device), choose to replace the online version, use it here, or keep both. **Edit this episode here** brings an episode and its pictures onto another device; **Write next episode** starts the next one with the same cast.
- Readers can **like**, **follow** stories and writers, **comment** and reply, and get **notifications**. Anyone can read without an account, including people who open a shared link without having the app set up.
- **Share** links show the title, a few lines and the cover in chat apps.
- **Moderation**: everyone can report a story, episode, comment or writer. Moderators work through the reports, hide content and suspend writers; the administrator (set on the server) appoints moderators. Every action is logged.

## Editing with AI

Every story is plain text in the [`.story` format](FORMAT.md).

- **Text** tab: edit that text directly.
- **AI** tab: copy the story with a format reminder for ChatGPT, Claude, or any other AI, then paste the answer back. You'll see what changed before you apply it.

## Development

Node 22.13 or newer (the server uses the built-in `node:sqlite`).

```bash
cd storyteller
npm install
npm run dev        # the app alone: http://localhost:5173 (Community shows "isn't set up here")
npm run dev:all    # the app and the Community server together (Vite proxies /api to :8787)
npm test           # unit and server tests (format, editor logic, gestures, exports, every API route)
npm run e2e        # Playwright on a phone viewport, against the real server with a throwaway data folder
npm run build      # type-check both sides, build the app into dist/ and the server into dist-server/
npm start          # serve everything from dist-server/main.js (see DEPLOY.md for the settings)
```

The app alone (`npm run build:app`, then `dist/`) still works on any static host, offline, without the Community.

Stack:
- App: Vite, TypeScript, Preact with signals, vite-plugin-pwa, `lucide-preact` icons, and the Figtree and Bricolage Grotesque fonts bundled so they work offline.
- Server: Hono on Node, `node:sqlite`, sharp for pictures, zod for input.

```
src/format/     .story parser, serializer, pictures, diff, AI helpers (also used by the server)
src/store/      IndexedDB, profiles, settings, undo history, editor state, auto-alternate
src/images/     picture storage, compression, cropping, display
src/shortcuts/  action registry, hotkeys, prefixes, keyboard bar, viewport tracking
src/gestures/   recognizer, built-in gestures, pad, recording UI
src/export/     script, print and backup exports, file saving
src/community/  API client, account, Discover/feed, story pages, reader, comments, publishing, moderation
src/shared/     the API's data shapes, shared with the server
src/ui/         sheets and confirmations, controls, PIN pad, install/update state
src/views/      home, editor, chat log, text mode, cast, AI, export, settings, profile screens
server/         Hono app: auth and sessions, pictures, stories/episodes, social, moderation, link previews
server/test/    server tests (Vitest, app.request with a temporary data folder)
e2e/            Playwright tests
```
