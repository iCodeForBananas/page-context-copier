// Page Context Copier — service worker.
// Toolbar click (or Alt+Shift+C) copies the whole page; the context menu can
// copy just the region around the current selection.

const OFFSCREEN_URL = 'src/offscreen.html';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'copy-page',
    title: 'Copy page context for AI',
    contexts: ['page', 'frame', 'link', 'image'],
  });
  chrome.contextMenus.create({
    id: 'copy-selection',
    title: 'Copy context of selection for AI',
    contexts: ['selection'],
  });
});

chrome.action.onClicked.addListener((tab) => copyContext(tab, 'page'));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  copyContext(tab, info.menuItemId === 'copy-selection' ? 'selection' : 'page');
});

async function copyContext(tab, mode) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/extract.js'],
    });
    const [{ result: text }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (m) => globalThis.__pageContextCopier.extract(m),
      args: [mode],
    });
    await writeClipboard(text);
    const tokens = Math.round(text.length / 4);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (msg) => globalThis.__pageContextCopier.toast(msg),
      args: [`Copied page context — ${text.length.toLocaleString()} chars (~${tokens.toLocaleString()} tokens)`],
    });
    flashBadge(tab.id, '✓', '#1f7a4d');
  } catch (err) {
    console.error('Page Context Copier failed:', err);
    // chrome://, the Web Store and other restricted pages can't be scripted.
    flashBadge(tab.id, '!', '#b3261e');
    chrome.action.setTitle({ tabId: tab.id, title: `Copy failed: ${err.message}` });
  }
}

function flashBadge(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2500);
}

// MV3 service workers have no DOM, so clipboard writes go through an offscreen document.
async function writeClipboard(text) {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (!existing.length) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['CLIPBOARD'],
      justification: 'Write the extracted page context to the clipboard',
    });
  }
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'copy', text });
  if (!res?.ok) throw new Error(res?.error || 'Clipboard write failed');
}
