/**
 * Copy to clipboard, with a fallback for webviews that deny the async
 * Clipboard API (WebKitGTK grants it inconsistently outside a user gesture).
 * Returns whether the text made it to the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Denied or unavailable — try the legacy path below.
  }

  try {
    const scratch = document.createElement('textarea')
    scratch.value = text
    scratch.setAttribute('readonly', '')
    // Off-screen but focusable: display:none would make the selection a no-op.
    scratch.style.position = 'fixed'
    scratch.style.top = '-1000px'
    scratch.style.opacity = '0'
    document.body.appendChild(scratch)
    scratch.select()
    const copied = document.execCommand('copy')
    scratch.remove()
    return copied
  } catch {
    return false
  }
}
