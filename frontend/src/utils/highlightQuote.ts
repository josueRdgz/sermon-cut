export function highlightPullQuote(transcript: string, maxChars = 160): string {
  const cleaned = transcript.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const sentences = cleaned.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const ranked = [...(sentences.length ? sentences : [cleaned])].sort((left, right) => {
    const delta = quoteScore(right) - quoteScore(left);
    return delta !== 0 ? delta : left.length - right.length;
  });
  const pick = ranked[0] ?? cleaned;
  if (pick.length <= maxChars) return pick;
  return `${pick.slice(0, maxChars - 1).trim()}…`;
}

function quoteScore(sentence: string): number {
  const words = sentence.split(/\s+/).filter(Boolean).length;
  let score = 0;
  if (words >= 6 && words <= 24) score += 2;
  if (/[?]/.test(sentence)) score += 1;
  if (/\b(por eso|usted|hoy|gracia|cristo|jesús|fe)\b/i.test(sentence)) score += 2;
  return score;
}
