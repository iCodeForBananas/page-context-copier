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
  // Show progress at once, so a click never looks like it did nothing.
  setBadge(tab.id, '…', '#5f6368');
  let step = 'reading the page';
  try {
    await withTimeout(
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/extract.js'] }),
      10000, step);
    const [{ result: text }] = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (m) => globalThis.__pageContextCopier.extract(m),
        args: [mode],
      }),
      30000, step);
    if (typeof text !== 'string' || !text) throw new Error('The page returned no content');

    step = 'writing to the clipboard';
    await writeClipboard(tab.id, text);

    const tokens = Math.round(text.length / 4);
    await showToast(tab.id,
      `Copied page context — ${text.length.toLocaleString()} chars (~${tokens.toLocaleString()} tokens)`, true);
    chrome.action.setTitle({ tabId: tab.id, title: 'Copy page context for AI (Alt+Shift+C)' });
    flashBadge(tab.id, '✓', '#1f7a4d');
  } catch (err) {
    const message = `Copy failed while ${step}: ${err?.message || err}`;
    console.error('Page Context Copier:', message, err);
    // chrome://, the Web Store and other restricted pages can't be scripted,
    // so the toast may not show there; the badge and its tooltip always do.
    flashBadge(tab.id, '!', '#b3261e', 8000);
    chrome.action.setTitle({ tabId: tab.id, title: message });
    await showToast(tab.id, message, false);
  }
}

function withTimeout(promise, ms, step) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s ${step}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function showToast(tabId, message, ok) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, good) => globalThis.__pageContextCopier?.toast(msg, good),
      args: [message, ok],
    });
  } catch {
    // Page can't be scripted; the badge already says what happened.
  }
}

function setBadge(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
}

function flashBadge(tabId, text, color, ms = 2500) {
  setBadge(tabId, text, color);
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), ms);
}

// MV3 service workers have no DOM, so clipboard writes go through an offscreen
// document. If that fails or hangs, fall back to copying from inside the page.
async function writeClipboard(tabId, text) {
  let offscreenError;
  try {
    await withTimeout(writeViaOffscreen(text), 5000, 'writing via the offscreen document');
    return;
  } catch (err) {
    offscreenError = err;
    console.warn('Page Context Copier: offscreen copy failed, trying the page', err);
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: copyInPage,
    args: [text],
  });
  if (!result?.ok) {
    throw new Error(`${offscreenError.message}; in-page copy also failed: ${result?.error || 'unknown error'}`);
  }
}

async function writeViaOffscreen(text) {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (!existing.length) {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['CLIPBOARD'],
        justification: 'Write the extracted page context to the clipboard',
      });
    } catch (err) {
      // Two quick clicks can race to create it; one existing document is fine.
      if (!/single offscreen/i.test(err.message)) throw err;
    }
  }
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'copy', text });
  if (!res?.ok) throw new Error(res?.error || 'Clipboard write failed');
}

// Runs in the page. The clipboardWrite permission lets execCommand('copy')
// work here without a user gesture.
function copyInPage(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.documentElement.appendChild(area);
  const active = document.activeElement;
  try {
    area.select();
    const ok = document.execCommand('copy');
    return ok ? { ok: true } : { ok: false, error: 'execCommand("copy") returned false' };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    area.remove();
    active?.focus?.();
  }
}
