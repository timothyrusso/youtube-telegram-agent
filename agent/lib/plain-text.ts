// Telegram shows Markdown literally (the channel sends no parse_mode), so strip what models
// tend to write anyway: bold/italic markers, headings, "*"/"-" bullets and inline code.
export function plainText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/gm, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^(\s*)[*-]\s+/gm, '$1• ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]+$/gm, '');
}
