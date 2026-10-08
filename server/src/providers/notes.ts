import { decodeEntities, untilStable } from '../recipe-web.ts';

/** An event's notes (its description) as plain text. Google and Outlook often send HTML: tags go,
 * paragraphs and <br> become line breaks, a link keeps its address, entities are decoded. Plain
 * text passes through untouched (only CRLF -> LF). Empty -> undefined. Kinwall never renders
 * notes as HTML either way. */
export function notesText(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let s = value.replace(/\r\n?/g, '\n');
  if (/<\/?[a-z][^>]*>/i.test(s)) {
    s = untilStable(s, (t) => t
      .replace(/<(script|style|head)\b[\s\S]*?<\s*\/\s*\1\b[^>]*>/gi, '')
      .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_, href: string, text: string) => {
        const label = text.replace(/<[^>]*>/g, '').trim();
        return !label || label === href || `mailto:${label}` === href ? label || href : `${label} (${href})`;
      })
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ''));
    s = decodeEntities(s).replace(/ /g, ' ');
  }
  s = s.split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return s || undefined;
}
