const copyTextWithSelection = (text: string) => {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }

  return copied
}

export async function copyTextToClipboard(text: string) {
  const normalizedText = text.trim()
  if (!normalizedText) {
    return false
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalizedText)
      return true
    }
  } catch {
    return copyTextWithSelection(normalizedText)
  }

  return copyTextWithSelection(normalizedText)
}
