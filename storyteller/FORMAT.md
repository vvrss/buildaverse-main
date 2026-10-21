# The `.story` format

Plain text that people and AIs can both read and edit. Storyteller saves every story in this format and reads it back exactly. What you paste into an AI is precisely what the app stores.

```
---
title: The Lighthouse
characters:
  ana: Ana Reyes  #e76f51
  tom: Tom        #2a9d8f
---

# Chapter 1: Storm

> The wind howled against the glass.

@ana: Did you hear that?
@tom (whispering): Stay still.
@ana: It's coming from below.
  It sounds like... knocking.

// Tom knows more than he says.
```

## Rules

| Syntax | Meaning |
|---|---|
| `--- … ---` | Header at the top: `title:` plus a `characters:` list |
| `  id: Display Name  #color` | One character (indented under `characters:`). The color is optional |
| `@id: text` | A line of dialog |
| `@id (direction): text` | Dialog with a stage direction or tone |
| `> text` | Narration or action |
| `# text` | Chapter or scene heading |
| `// text` | Note for yourself or an AI. Shown in the editor as a sticky note |
| line indented by 2 spaces | Continues the line above it (multi-line dialog or narration) |
| blank line | Ignored. Use freely for readability |

- **Ids** (`ana`, `tom`) are what you type after `@`. They can contain letters, numbers, `-` and `_`. Matching is case-insensitive.
- **Other header keys** (for example `mood: stormy`) are kept as they are.

## Pictures

A story never contains the picture itself, only a **picture code**: `img:` plus 16 letters and digits taken from the picture's contents. The picture is kept on your device (and on the server, once an episode is published). The app adds the codes for you, so you rarely type one.

| Syntax | Meaning |
|---|---|
| `![caption](img:3fa94c0d1b2e7a55)` | A picture in the story, on a line of its own. The caption is optional: `![](img:…)` |
| `  ana: Ana Reyes  img:9c1d2e3f4a5b6c7d  #e76f51` | A character's portrait, between the name and the color |
| `cover: img:0a1b2c3d4e5f6a7b` | The story's cover, in the header |

- Keep every `img:` code exactly as it is. An AI must not invent or change one: a code with no picture behind it shows as "Picture not on this device".
- Pictures from the web (`![x](https://…)`) are never loaded. Such a line is kept as narration with a warning.
- Older versions of the app read a picture line as narration and write it back as `> ![caption](img:…)`. That still reads as a picture, so nothing is lost.

## Forgiving reading

When text comes back from an AI, the app accepts common mistakes. It reports each one with its line number and never drops a line silently:

- `@someone` not in the header → added to the cast, with a warning.
- `Ana: text` or `Ana Reyes (calm): text` without the `@` → read as dialog if Ana is in the cast.
- `@ana text` without the colon → read as dialog.
- A line with no marker → kept as narration.
- An unclosed header → an error. The header is assumed to end at the first blank line.
- A reply wrapped in a ```` ```story ```` code block with chat around it → only the code block is used.

## Using it with an AI

In the story, open **AI** → **Copy for AI**. You can type what you want changed first. This copies the story with a short reminder of these rules. Paste it into any AI chat. Then paste the whole answer into **Paste the reply**. You'll see the lines that changed before you click **Apply changes**. Undo works afterwards too.
