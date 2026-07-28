/**
 * Copy text from both normal browsers and embedded/webview browsers.
 * Webviews commonly expose navigator.clipboard while denying write access,
 * so the selection-based fallback is required even when the API exists.
 */
export async function copyText(text: string): Promise<boolean> {
  // Supplying clipboardData directly is the most reliable path in embedded
  // Chromium shells; it avoids depending on selection ownership.
  let eventCopied = false;
  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    eventCopied = true;
  };
  document.addEventListener('copy', handleCopy);
  try {
    document.execCommand('copy');
  } catch {
    // Continue with the selection and async API fallbacks.
  } finally {
    document.removeEventListener('copy', handleCopy);
  }
  if (eventCopied) return true;

  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.left = '-9999px';
  field.style.top = '0';
  document.body.appendChild(field);

  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0
    ? selection.getRangeAt(0)
    : null;
  field.focus();
  field.select();
  field.setSelectionRange(0, field.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  field.remove();
  if (previousRange && selection) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }
  if (copied) return true;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Both available copy paths failed.
  }
  return false;
}
