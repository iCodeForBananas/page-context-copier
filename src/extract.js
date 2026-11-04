// Page Context Copier — page extractor.
// Injected into the active tab. Walks the rendered DOM and produces a readable,
// indented outline of the page's content plus accessibility info and metadata.
// It deliberately drops raw HTML structure: generic wrappers (div/span) collapse,
// while semantic nesting (landmarks, lists, tables, headings, controls) is kept.

(() => {
  const INDENT = '  ';
  const MAX_VALUE = 300;
  const MAX_OPTIONS = 25;
  const MAX_JSONLD = 3000;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'BASE',
    'PARAM', 'SOURCE', 'TRACK', 'MAP', 'AREA', 'DATALIST', 'OPTION', 'OPTGROUP',
  ]);

  const LANDMARK_TAGS = {
    NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', FORM: 'form',
    SEARCH: 'search', ARTICLE: 'article', DIALOG: 'dialog', FIGURE: 'figure',
    FIELDSET: 'group', DETAILS: 'details', ADDRESS: 'address',
  };

  // Roles that render as a single line (name + state), not as a container.
  const LEAF_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton',
    'textbox', 'searchbox', 'combobox', 'progressbar', 'meter', 'img', 'image',
    'separator', 'status', 'alert',
  ]);
  const IGNORED_ROLES = new Set(['presentation', 'none', 'generic', 'paragraph', 'text']);

  // Marks <br> inside a text run; distinct from source-formatting newlines.
  const LINE_BREAK = ' ';
  const collapse = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  const quote = (s) => `"${clip(collapse(s), MAX_VALUE).replace(/"/g, '\\"')}"`;

  function shortUrl(url) {
    if (!url) return '';
    if (url.startsWith('data:')) return clip(url, 40);
    return clip(url, 200);
  }

  function isHidden(el, style) {
    if (el.hidden) return true;
    if (style.display === 'none') return true;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    if (el.getAttribute('aria-hidden') === 'true' && !collapse(el.textContent)) return true;
    return false;
  }

  function textOfIds(ids, doc) {
    return collapse(
      ids.split(/\s+/).map((id) => doc.getElementById(id)?.textContent || '').join(' ')
    );
  }

  // Simplified accessible-name computation.
  function accName(el) {
    const doc = el.ownerDocument;
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = textOfIds(labelledby, doc);
      if (t) return t;
    }
    const aria = collapse(el.getAttribute('aria-label'));
    if (aria) return aria;
    if (el.labels && el.labels.length) {
      const t = collapse(Array.from(el.labels).map((l) => l.innerText || l.textContent).join(' '));
      if (t) return t;
    }
    if (el.tagName === 'IMG' || (el.tagName === 'INPUT' && el.type === 'image')) {
      const alt = el.getAttribute('alt');
      if (alt) return collapse(alt);
    }
    if (el.tagName === 'FIELDSET') {
      const legend = el.querySelector(':scope > legend');
      if (legend) return collapse(legend.textContent);
    }
    if (el.tagName === 'TABLE' && el.caption) return collapse(el.caption.textContent);
    if (el.tagName === 'FIGURE') {
      const cap = el.querySelector(':scope > figcaption');
      if (cap) return collapse(cap.textContent);
    }
    if (el instanceof SVGElement) {
      const title = el.querySelector(':scope > title');
      if (title) return collapse(title.textContent);
    }
    return collapse(el.getAttribute('title'));
  }

  function description(el) {
    const ids = el.getAttribute('aria-describedby');
    return ids ? textOfIds(ids, el.ownerDocument) : '';
  }

  function states(el) {
    const out = [];
    const a = (n) => el.getAttribute(n);
    if (a('aria-expanded') === 'true') out.push('expanded');
    if (a('aria-expanded') === 'false') out.push('collapsed');
    if (a('aria-pressed') === 'true') out.push('pressed');
    if (a('aria-selected') === 'true') out.push('selected');
    if (a('aria-checked') === 'true') out.push('checked');
    if (a('aria-checked') === 'mixed') out.push('mixed');
    const cur = a('aria-current');
    if (cur && cur !== 'false') out.push(cur === 'true' ? 'current' : `current ${cur}`);
    if (el.disabled || a('aria-disabled') === 'true') out.push('disabled');
    if (el.required || a('aria-required') === 'true') out.push('required');
    if (el.readOnly || a('aria-readonly') === 'true') out.push('readonly');
    if (a('aria-invalid') && a('aria-invalid') !== 'false') out.push('invalid');
    const popup = a('aria-haspopup');
    if (popup && popup !== 'false') out.push(`has ${popup === 'true' ? 'menu' : popup} popup`);
    if (el.tagName === 'DETAILS') out.push(el.open ? 'open' : 'closed');
    if (el === el.ownerDocument.activeElement && el !== el.ownerDocument.body) out.push('focused');
    const live = a('aria-live');
    if (live && live !== 'off') out.push(`live ${live}`);
    return out.length ? ` (${out.join(', ')})` : '';
  }

  function withDesc(line, el) {
    const d = description(el);
    return d ? `${line} — ${clip(d, MAX_VALUE)}` : line;
  }

  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').split(/\s+/)[0].toLowerCase();
    if (explicit && !IGNORED_ROLES.has(explicit)) return explicit;
    if (explicit) return null;
    const tag = el.tagName;
    if (tag === 'HEADER' || tag === 'FOOTER') {
      // Only page-level header/footer are landmarks.
      if (el.parentElement?.closest('article, aside, main, nav, section')) return null;
      return tag === 'HEADER' ? 'banner' : 'contentinfo';
    }
    if (tag === 'SECTION') return accName(el) ? 'region' : null;
    return LANDMARK_TAGS[tag] || null;
  }

  function headingLevel(el) {
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m) return +m[1];
    if (el.getAttribute('role') === 'heading') return +(el.getAttribute('aria-level') || 2);
    return 0;
  }

  // ---------- form controls ----------

  function controlLine(el) {
    const tag = el.tagName;
    const name = accName(el);
    const st = states(el);
    if (tag === 'SELECT') {
      const opts = Array.from(el.options);
      const selected = opts.filter((o) => o.selected).map((o) => collapse(o.text));
      const list = opts.slice(0, MAX_OPTIONS).map((o) => collapse(o.text)).join(' | ');
      const more = opts.length > MAX_OPTIONS ? ` | …+${opts.length - MAX_OPTIONS} more` : '';
      return withDesc(
        `[${el.multiple ? 'listbox' : 'combobox'} ${quote(name)} = ${selected.map(quote).join(', ') || 'none'}${st}] options: ${list}${more}`,
        el
      );
    }
    if (tag === 'TEXTAREA') {
      const v = el.value ? ` = ${quote(el.value)}` : '';
      const ph = el.placeholder ? ` placeholder ${quote(el.placeholder)}` : '';
      return withDesc(`[textarea ${quote(name)}${v}${ph}${st}]`, el);
    }
    if (tag === 'BUTTON') {
      return withDesc(`[button ${quote(name || el.innerText || el.textContent)}${st}]`, el);
    }
    // INPUT
    const type = (el.type || 'text').toLowerCase();
    if (type === 'hidden') return '';
    if (type === 'checkbox' || type === 'radio') {
      const mark = type === 'checkbox' ? (el.checked ? '[x]' : '[ ]') : el.checked ? '(•)' : '( )';
      return withDesc(`${mark} ${name || '(unlabeled ' + type + ')'}${st}`, el);
    }
    if (['submit', 'button', 'reset'].includes(type)) {
      return withDesc(`[button ${quote(name || el.value || type)}${st}]`, el);
    }
    if (type === 'image') return `[button ${quote(name || 'image')}${st}]`;
    if (type === 'file') return withDesc(`[file input ${quote(name)}${st}]`, el);
    const sensitive =
      type === 'password' || /cc-|password|one-time-code/.test(el.autocomplete || '');
    let v = '';
    if (el.value) v = sensitive ? ' = (filled, value hidden)' : ` = ${quote(el.value)}`;
    const ph = el.placeholder ? ` placeholder ${quote(el.placeholder)}` : '';
    const kind = type === 'text' ? 'textbox' : type === 'search' ? 'searchbox' : `${type} input`;
    return withDesc(`[${kind} ${quote(name)}${v}${ph}${st}]`, el);
  }

  function imageLine(el) {
    const alt = el.getAttribute('alt');
    if (alt === '' && !el.getAttribute('aria-label')) return ''; // decorative
    const name = accName(el);
    const src = el.currentSrc || el.src || '';
    if (!name) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 && r.height < 24) return ''; // unlabeled icon / tracking pixel
      const file = src.split(/[?#]/)[0].split('/').pop();
      return `![(no alt) ${clip(file, 60)}](${shortUrl(src)})`;
    }
    return `![${name}](${shortUrl(src)})`;
  }

  function mediaLine(el) {
    const kind = el.tagName.toLowerCase();
    const src = el.currentSrc || el.src || el.querySelector('source')?.src || '';
    const name = accName(el);
    return `[${kind}${name ? ' ' + quote(name) : ''}${src ? ' ' + shortUrl(src) : ''}]`;
  }

  // ---------- inline rendering ----------

  function childNodesOf(node) {
    if (node.shadowRoot) return Array.from(node.shadowRoot.childNodes);
    if (node.tagName === 'SLOT') {
      const assigned = node.assignedNodes({ flatten: true });
      return assigned.length ? assigned : Array.from(node.childNodes);
    }
    return Array.from(node.childNodes);
  }

  function inlineText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node;
    if (SKIP_TAGS.has(el.tagName) || el.id === '__pcc_toast') return '';
    const style = getComputedStyle(el);
    if (style.display !== 'contents' && isHidden(el, style)) return '';
    const tag = el.tagName;
    const role = roleOf(el);

    if (tag === 'BR') return LINE_BREAK;
    if (tag === 'IMG') return ' ' + imageLine(el) + ' ';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') {
      return ' ' + controlLine(el) + ' ';
    }
    if (tag === 'svg' || tag === 'SVG' || el instanceof SVGElement) {
      const n = accName(el);
      return n ? ` [icon ${quote(n)}] ` : '';
    }
    if (tag === 'A' && el.hasAttribute('href')) {
      const label = collapse(innerInline(el)) || accName(el) || '(link)';
      return `[${label}](${linkTarget(el)})${states(el)}`;
    }
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') {
      const t = collapse(el.textContent);
      return t ? '`' + t + '`' : '';
    }
    if (role && LEAF_ROLES.has(role)) {
      if (role === 'img' || role === 'image') {
        const n = accName(el);
        return n ? ` [img ${quote(n)}] ` : '';
      }
      const label = accName(el) || collapse(innerInline(el));
      return ` [${role} ${quote(label)}${states(el)}] `;
    }
    const inner = innerInline(el);
    const name = collapse(el.getAttribute('aria-label'));
    if (name && !collapse(inner)) return ` [${quote(name)}] `;
    return inner;
  }

  function innerInline(el) {
    return childNodesOf(el).reduce((acc, n) => joinInline(acc, inlineText(n)), '');
  }

  // Keep adjacent links/controls from running together: "[A](x)[B](y)" → "[A](x) [B](y)".
  function joinInline(a, b) {
    return /[\])]$/.test(a) && /^[[!]/.test(b) ? `${a} ${b}` : a + b;
  }

  function linkTarget(a) {
    const raw = a.getAttribute('href') || '';
    if (raw.startsWith('#')) return raw;
    if (/^javascript:/i.test(raw)) return 'javascript:';
    return shortUrl(a.href);
  }

  // ---------- block walk ----------

  function isInline(el, style) {
    const d = style.display;
    if (d === 'contents') return false;
    if (!d.startsWith('inline')) return false;
    if (headingLevel(el)) return false; // some sites style headings inline
    // A link or inline-block wrapping block layout (e.g. a card) is a block.
    if (d !== 'inline' && (el.tagName === 'A' || roleOf(el) === null)) {
      for (const c of el.children) {
        const cd = getComputedStyle(c).display;
        if (cd === 'block' || cd === 'flex' || cd === 'grid' || cd === 'list-item' || cd === 'table') {
          return false;
        }
      }
    }
    return true;
  }

  function pushText(lines, text, depth) {
    for (const part of text.split(LINE_BREAK)) {
      const t = collapse(part);
      if (t) lines.push({ depth, text: t });
    }
  }

  const FORM_CONTROLS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);

  // The visible control a <label> names, if any. Custom-styled controls often
  // hide the real input; then the label text is kept as plain text instead.
  function labelledControl(label) {
    const c = label.control;
    if (!c || (c.tagName === 'INPUT' && c.type === 'hidden')) return null;
    return isHidden(c, getComputedStyle(c)) ? null : c;
  }

  // Walk children of `node`, emitting lines at `depth`.
  function walkChildren(node, depth, lines) {
    let run = '';
    const flush = () => {
      pushText(lines, run, depth);
      run = '';
    };
    for (const child of childNodesOf(node)) {
      if (child.nodeType === Node.TEXT_NODE) {
        run += child.data;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (SKIP_TAGS.has(child.tagName) || child.id === '__pcc_toast') continue;
      const style = getComputedStyle(child);
      if (style.display !== 'contents' && isHidden(child, style)) continue;
      if (child.tagName === 'LABEL' && labelledControl(child)) {
        // The control's line already carries the label text as its name.
        const control = labelledControl(child);
        flush();
        if (child.contains(control)) {
          const l = controlLine(control);
          if (l) lines.push({ depth, text: l });
        }
        continue;
      }
      if (isInline(child, style) && !FORM_CONTROLS.has(child.tagName)) {
        run = joinInline(run, inlineText(child));
        continue;
      }
      flush();
      walkBlock(child, depth, lines, style);
    }
    flush();
  }

  // Emit `header` at depth and children nested beneath. When `mergeFirst` is set,
  // the first child text line is folded onto the header line (list items, links).
  function container(el, depth, lines, header, mergeFirst) {
    const sub = [];
    walkChildren(el, depth + 1, sub);
    if (mergeFirst && sub[0] && sub[0].depth === depth + 1 && !sub[0].block) {
      sub[0] = { depth, text: `${header} ${sub[0].text}` };
      lines.push(...sub);
    } else {
      lines.push({ depth, text: header, block: true }, ...sub);
    }
  }

  function flatText(el) {
    const sub = [];
    walkChildren(el, 0, sub);
    return sub.map((l) => l.text).join(' / ');
  }

  function rowLine(row, depth, lines) {
    const cells = (
      row.cells
        ? Array.from(row.cells)
        : Array.from(row.querySelectorAll(':scope > [role=cell], :scope > [role=gridcell], :scope > [role=columnheader], :scope > [role=rowheader]'))
    ).filter((c) => !isHidden(c, getComputedStyle(c)));
    if (!cells.length) return walkChildren(row, depth, lines);
    // Layout-style rows holding nested tables (navboxes etc.) read better as an outline.
    if (cells.some((c) => c.querySelector('table, [role=table], [role=grid]'))) {
      for (const c of cells) walkChildren(c, depth, lines);
      return;
    }
    const texts = cells.map((c) => flatText(c).replace(/\|/g, '\\|'));
    lines.push({ depth, text: `| ${texts.join(' | ')} |${states(row)}` });
    const allHeaders = cells.every(
      (c) => c.tagName === 'TH' || /columnheader/.test(c.getAttribute('role') || '')
    );
    if (allHeaders) lines.push({ depth, text: `|${' --- |'.repeat(cells.length)}` });
  }

  function walkBlock(el, depth, lines, style) {
    const tag = el.tagName;
    if (style.display === 'contents') return walkChildren(el, depth, lines);

    const level = headingLevel(el);
    if (level) {
      const t = collapse(innerInline(el)) || accName(el);
      if (t) lines.push({ depth, text: `${'#'.repeat(level)} ${t}`, block: true });
      return;
    }

    if (tag === 'IMG') {
      const l = imageLine(el);
      if (l) lines.push({ depth, text: l });
      return;
    }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') {
      const l = controlLine(el);
      if (l) lines.push({ depth, text: l });
      return;
    }
    if (tag === 'VIDEO' || tag === 'AUDIO') {
      lines.push({ depth, text: mediaLine(el) });
      return;
    }
    if (tag === 'CANVAS' || tag === 'OBJECT' || tag === 'EMBED') {
      const n = accName(el) || collapse(el.textContent);
      if (n) lines.push({ depth, text: `[${tag.toLowerCase()} ${quote(n)}]` });
      return;
    }
    if (el instanceof SVGElement) {
      const n = accName(el);
      if (n) lines.push({ depth, text: `[graphic ${quote(n)}]` });
      return;
    }
    if (tag === 'HR') {
      lines.push({ depth, text: '---' });
      return;
    }
    if (tag === 'PRE') {
      const code = (el.innerText || el.textContent).replace(/\n+$/, '');
      lines.push({ depth, text: '```\n' + code + '\n```', raw: true });
      return;
    }
    if (tag === 'IFRAME' || tag === 'FRAME') {
      const header = `[iframe${accName(el) ? ' ' + quote(accName(el)) : ''} ${shortUrl(el.src)}]`;
      let doc = null;
      try {
        doc = el.contentDocument;
      } catch (_) {}
      if (doc?.body) container(doc.body, depth, lines, header, false);
      else lines.push({ depth, text: header + ' (cross-origin, content not captured)' });
      return;
    }
    if (tag === 'TABLE' && !['presentation', 'none'].includes(el.getAttribute('role'))) {
      const name = accName(el);
      lines.push({ depth, text: `[table${name ? ' ' + quote(name) : ''}]`, block: true });
      for (const row of el.rows) rowLine(row, depth + 1, lines);
      return;
    }

    const role = roleOf(el);

    if (role === 'row') return rowLine(el, depth, lines);

    if (tag === 'LI' || role === 'listitem' || role === 'treeitem') {
      let bullet = '-';
      const list = el.parentElement;
      if (list?.tagName === 'OL') {
        const items = Array.from(list.children).filter((c) => c.tagName === 'LI');
        const start = list.start || 1;
        bullet = `${list.reversed ? items.length - items.indexOf(el) : start + items.indexOf(el)}.`;
      }
      if (role === 'treeitem') bullet = '- [treeitem]';
      return container(el, depth, lines, bullet + states(el), true);
    }

    if (tag === 'UL' || tag === 'OL' || tag === 'MENU' || tag === 'DL' || role === 'list') {
      const name = accName(el);
      if (name) return container(el, depth, lines, `[list ${quote(name)}]`, false);
      return walkChildren(el, depth, lines);
    }
    if (tag === 'DT') {
      return container(el, depth, lines, '-', true);
    }
    if (tag === 'DD') {
      return walkChildren(el, depth + 1, lines);
    }

    if (tag === 'BLOCKQUOTE') {
      return container(el, depth, lines, '>', true);
    }

    if (tag === 'A' && el.hasAttribute('href')) {
      return container(el, depth, lines, `[link → ${linkTarget(el)}]${states(el)}`, true);
    }

    if (role && LEAF_ROLES.has(role)) {
      const label = accName(el) || collapse(flatText(el));
      lines.push({ depth, text: withDesc(`[${role} ${quote(label)}${states(el)}]`, el) });
      return;
    }

    if (el.isContentEditable && !el.parentElement?.isContentEditable) {
      const name = accName(el);
      return container(el, depth, lines, `[editable${name ? ' ' + quote(name) : ''}]`, false);
    }

    if (role) {
      const name = accName(el);
      return container(el, depth, lines, `[${role}${name ? ' ' + quote(name) : ''}${states(el)}]`, false);
    }

    // Generic element carrying an aria-label: keep it as a labelled group.
    const label = collapse(el.getAttribute('aria-label'));
    if (label) return container(el, depth, lines, `[group ${quote(label)}${states(el)}]`, false);

    walkChildren(el, depth, lines);
  }

  function render(lines) {
    const out = [];
    let prev = null;
    for (const l of lines) {
      const pad = INDENT.repeat(l.depth);
      if (l.text === prev) continue; // drop immediate duplicates (e.g. repeated labels)
      prev = l.text;
      out.push(l.text.split('\n').map((s) => pad + s).join('\n'));
    }
    return out.join('\n');
  }

  // ---------- metadata ----------

  function metadata(doc) {
    const out = [];
    const seen = new Set();
    for (const m of doc.querySelectorAll('meta[name], meta[property], meta[itemprop]')) {
      const key = m.getAttribute('property') || m.getAttribute('name') || m.getAttribute('itemprop');
      const val = collapse(m.getAttribute('content'));
      if (!key || !val || /^(viewport|theme-color|color-scheme|format-detection|referrer|google-site-verification|msapplication-|apple-mobile|csrf)/i.test(key)) continue;
      const line = `- ${key}: ${clip(val, MAX_VALUE)}`;
      if (!seen.has(line)) {
        seen.add(line);
        out.push(line);
      }
    }
    for (const rel of ['canonical', 'alternate', 'prev', 'next', 'author', 'license']) {
      for (const l of doc.querySelectorAll(`link[rel~="${rel}"][href]`)) {
        const extra = l.hreflang ? ` (${l.hreflang})` : l.type ? ` (${l.type})` : '';
        out.push(`- link[${rel}]: ${shortUrl(l.href)}${extra}`);
      }
    }
    return out;
  }

  function jsonLd(doc) {
    const out = [];
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        out.push(clip(JSON.stringify(JSON.parse(s.textContent)), MAX_JSONLD));
      } catch (_) {}
    }
    return out;
  }

  function headingOutline(lines) {
    return lines.filter((l) => /^#{1,6} /.test(l.text)).map((l) => {
      const level = l.text.indexOf(' ');
      return `${INDENT.repeat(level - 1)}- ${l.text.slice(level + 1)}`;
    });
  }

  // ---------- entry point ----------

  function extract(mode = 'page') {
    const doc = document;
    const sel = window.getSelection();
    const selText = sel && !sel.isCollapsed ? sel.toString().trim() : '';

    let root = doc.body;
    if (mode === 'selection' && sel && sel.rangeCount && !sel.isCollapsed) {
      const anc = sel.getRangeAt(0).commonAncestorContainer;
      root = anc.nodeType === Node.ELEMENT_NODE ? anc : anc.parentElement;
    }

    const lines = [];
    if (root) walkChildren(root, 0, lines);

    const head = [
      '# Page Context',
      `Title: ${collapse(doc.title) || '(untitled)'}`,
      `URL: ${location.href}`,
    ];
    if (doc.documentElement.lang) head.push(`Language: ${doc.documentElement.lang}`);
    const desc = doc.querySelector('meta[name="description"]')?.content;
    if (desc) head.push(`Description: ${collapse(desc)}`);
    head.push(`Captured: ${new Date().toString()}`);
    head.push(
      `Viewport: ${innerWidth}x${innerHeight}, scrolled to ${Math.round(scrollY)} of ${doc.documentElement.scrollHeight}px`
    );
    const active = doc.activeElement;
    if (active && active !== doc.body && active !== doc.documentElement) {
      const n = accName(active) || collapse(active.innerText || '').slice(0, 80);
      head.push(`Focused element: <${active.tagName.toLowerCase()}>${n ? ' ' + quote(n) : ''}`);
    }

    const sections = [head.join('\n')];

    if (mode === 'selection') {
      sections.push(`## Selected text\n${selText}`);
    } else if (selText) {
      sections.push(`## Currently selected text\n${clip(selText, 2000)}`);
    }

    const meta = metadata(doc);
    if (meta.length) sections.push(`## Metadata\n${meta.join('\n')}`);

    const ld = jsonLd(doc);
    if (ld.length) sections.push(`## Structured data (JSON-LD)\n${ld.join('\n')}`);

    if (mode !== 'selection') {
      const outline = headingOutline(lines);
      if (outline.length) sections.push(`## Heading outline\n${outline.join('\n')}`);
    }

    sections.push(
      `## ${mode === 'selection' ? 'Selection context' : 'Content'}\n` +
        'Notation: [role "name" (states)] = landmark/control/region, [text](url) = link, ' +
        '![alt](src) = image, # = heading level, | a | b | = table row, indentation = nesting.\n\n' +
        render(lines)
    );

    return sections.join('\n\n') + '\n';
  }

  function toast(message, ok = true) {
    document.getElementById('__pcc_toast')?.remove();
    const el = document.createElement('div');
    el.id = '__pcc_toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    Object.assign(el.style, {
      position: 'fixed', zIndex: '2147483647', right: '16px', bottom: '16px',
      padding: '10px 14px', borderRadius: '8px', font: '13px/1.4 system-ui, sans-serif',
      color: '#fff', background: ok ? '#1f7a4d' : '#b3261e',
      boxShadow: '0 4px 16px rgba(0,0,0,.25)', transition: 'opacity .3s', opacity: '1',
    });
    document.documentElement.appendChild(el);
    setTimeout(() => (el.style.opacity = '0'), 2200);
    setTimeout(() => el.remove(), 2600);
  }

  globalThis.__pageContextCopier = { extract, toast };
})();
