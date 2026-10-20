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
