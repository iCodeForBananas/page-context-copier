// Offscreen document: the only MV3 context that can write to the clipboard
// without the page needing focus or a user gesture.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'copy') return;
  try {
    const buffer = document.getElementById('buffer');
    buffer.value = msg.text;
    buffer.select();
    const ok = document.execCommand('copy');
    buffer.value = '';
    sendResponse(ok ? { ok: true } : { ok: false, error: 'execCommand("copy") returned false' });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
});
