// Summary is trimmed; the description keeps its indentation (code blocks) minus blank edges.
export function buildMessage(summary: string, description: string): string {
  const body = description.replace(/^(\s*\n)+/, '').trimEnd()
  return body ? `${summary.trim()}\n\n${body}` : summary.trim()
}
