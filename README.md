# Page Context Copier

A Chrome extension (Manifest V3) that copies a web page as clean, structured context for an AI agent. Click it to get the page's text as an indented outline that keeps the nesting of lists, sections and tables. The outline also carries accessibility info (ARIA roles, labels, states, alt text, form labels, link targets) and page metadata. Raw HTML is left out.

![Screenshot](store/screenshot-1.png)

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
4. Pin the extension from the puzzle-piece menu so the button is always visible.

## Use

- **Toolbar button** or **Alt+Shift+C** copies the whole page. You can change the shortcut at `chrome://extensions/shortcuts`.
- **Right-click → "Copy context of selection for AI"** copies only the part of the page around your selection.
- A toast in the corner shows the size of what was copied (characters and roughly how many tokens). The toolbar badge shows ✓, or `!` on pages Chrome won't let extensions read (`chrome://`, the Web Store, the PDF viewer).

## Output format

```
# Page Context
Title: Acme Dashboard
URL: https://acme.example/dashboard
Language: en
Captured: …
Viewport: 1280x800, scrolled to 0 of 1142px

## Metadata
- og:title: Acme Dashboard
- link[canonical]: https://example.com/dashboard

## Structured data (JSON-LD)
{"@context":"https://schema.org","@type":"WebPage",…}

## Heading outline
- Dashboard
  - Stats

## Content
[banner]
  [navigation "Primary"]
    - [Home](/) (current page)
    - [Reports](/reports)
      - [Q1](/reports/q1)
    - [button "More" (collapsed, has menu popup)]
[main]
  # Dashboard
  Welcome back, Sam. You have [3 new messages](/inbox).
  [region "Stats"]
    ## Stats
    [table "Monthly revenue"]
      | Month | Revenue |
      | --- | --- |
      | Jan | $10k |
  [form "Settings"]
    [email input "Email" = "sam@example.com" (required)]
    [password input "Password" = (filled, value hidden)]
    [x] Subscribe
    [combobox "Theme" = "Dark"] options: Light | Dark
```

How the outline is built:

- **Generic wrappers collapse.** `div`/`span` soup doesn't add indentation. Landmarks, lists, list items, tables, labelled groups, ARIA widgets, dialogs and same-origin iframes do.
- **Inline content stays inline.** Links become `[text](url)`, images `![alt](src)` and code `` `code` ``. Adjacent text is joined into readable lines.
- **Hidden content is skipped** (`display:none`, `visibility:hidden`, `[hidden]`). Screen-reader-only text is kept because it often explains icons.
- **Open shadow DOM and slots are followed**, so web-component apps come through.
- **Sensitive values are masked.** Password and credit-card/one-time-code fields show `(filled, value hidden)`, and hidden inputs are dropped.
- Decorative images (`alt=""`) and small unlabeled icons are dropped.

## How it works

| File | Role |
| --- | --- |
| `src/background.js` | Service worker. Handles the toolbar click, shortcut and context menu, injects the extractor, shows badge feedback |
| `src/extract.js` | Injected into the tab. Walks the DOM and builds the outline, metadata and toast |
| `src/offscreen.html/js` | Offscreen document that writes to the clipboard (MV3 service workers have no DOM) |

Permissions: `activeTab` + `scripting` (read the current tab only when you click), `clipboardWrite` + `offscreen` (copy), `contextMenus` (right-click item). There are no host permissions, no network requests and no stored data.

## Development

- `test/fixture.html` is a page that exercises most cases. Serve the repo (`python -m http.server 8765`), open `http://localhost:8765/test/fixture.html` and run `__pageContextCopier.extract('page')` in DevTools.
- After editing, click the reload icon on the extension card in `chrome://extensions`.

## Publishing to the Chrome Web Store

```bash
python scripts/package.py              # → dist/page-context-copier-<version>.zip
python scripts/render_store_images.py  # → store/*.png from store/*.html
```

Listing copy, permission justifications and the data-use answers are in [`store/LISTING.md`](store/LISTING.md). The privacy policy is [`PRIVACY.md`](PRIVACY.md).

## License

MIT
