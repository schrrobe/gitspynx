// IPC messages to the terminal are capped (1 MB); larger pastes go in pieces, never splitting
// a surrogate pair.
export function splitForIpc(text: string, size = 64 * 1024): string[] {
  const parts: string[] = []
  for (let i = 0; i < text.length; ) {
    let end = Math.min(text.length, i + size)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
    parts.push(text.slice(i, end))
    i = end
  }
  return parts.length ? parts : ['']
}
