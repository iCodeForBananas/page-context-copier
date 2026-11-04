# Chrome Web Store listing

Paste these into the Developer Dashboard (https://chrome.google.com/webstore/devconsole).

## Package

`dist/page-context-copier-1.0.0.zip`. Rebuild it with `python scripts/package.py`.

## Store listing tab

**Name:** Page Context Copier

**Summary** (132 char max):
One click copies any web page as a clean, structured outline — text, links, headings, ARIA roles and metadata — for your AI agent.

**Category:** Developer Tools (Productivity → Tools also fits)

**Language:** English

**Description:**

```
Paste web pages into ChatGPT, Claude, Cursor or any AI agent without losing the structure.

Copy-pasting a page usually gives you either a flat wall of text or a pile of HTML. Page Context Copier gives you something in between: a readable, indented outline of everything on the page, with the context an AI needs to understand it.

WHAT YOU GET
• Text in reading order, with nesting kept for lists, sections, tables and menus
• Headings as # / ## / ###, plus a separate heading outline
• Links as [text](url) and images as ![alt text](src)
• Tables as | rows | with header separators
• Form fields with their labels, current values, options and states (required, checked, disabled…)
• ARIA landmarks, roles, labels and states (navigation, main, dialog, tab "Settings" (selected), button "Menu" (expanded)…)
• Page metadata: title, URL, language, description, Open Graph / Twitter tags, canonical link, JSON-LD structured data
• Which element has focus and any text you've selected

HOW TO USE
• Click the toolbar button, or press Alt+Shift+C, to copy the whole page
• Right-click a selection and choose "Copy context of selection for AI" to copy just that part
• A small notice shows how much was copied, including an approximate token count

SMART BY DEFAULT
• Layout wrappers (div soup) collapse, so the outline mirrors the page's meaning instead of its markup
• Hidden elements are skipped; screen-reader-only text is kept
• Follows shadow DOM and same-origin iframes
• Password, credit card and one-time-code values are never copied

PRIVATE
Everything runs locally in your browser. The extension only reads the page when you click it, makes no network requests, stores nothing, and has no analytics. The result goes to your clipboard and nowhere else.
```

**Graphic assets:**
- Store icon: `icons/icon128.png`
- Screenshots (1280×800): `store/screenshot-1.png`, `store/screenshot-2.png`
- Small promo tile (440×280): `store/promo-small.png`

## Privacy tab

**Single purpose:**
Copy the content of the current web page to the clipboard as a structured text outline, with accessibility information and page metadata, so it can be pasted into an AI assistant.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| activeTab | Grants temporary access to the tab the user is looking at, only when they click the toolbar button, press the shortcut or use the context menu, so the extension can read that page's content. |
| scripting | Injects the extraction script into the active tab (via activeTab) to read the visible text, structure, ARIA attributes and metadata, and to show a short "copied" notice. |
| clipboardWrite | Writes the generated outline to the clipboard, which is the extension's only output. |
| offscreen | Manifest V3 service workers can't access the clipboard, so a hidden offscreen document with the CLIPBOARD reason performs the copy. |
| contextMenus | Adds the "Copy page context for AI" and "Copy context of selection for AI" right-click items. |

**Remote code:** No, I am not using remote code. All JavaScript is packaged in the extension.

**Data usage:**
- What user data do you plan to collect: check **none**. Page content is processed locally, only on user action, and is written only to the user's own clipboard. It is never transmitted, stored or collected by the developer.
- Certify all three disclosures: data is not sold to third parties, not used or transferred for purposes unrelated to the single purpose, and not used for creditworthiness or lending.

**Privacy policy URL:**
https://github.com/<your-username>/page-context-copier/blob/main/PRIVACY.md
