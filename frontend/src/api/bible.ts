export interface BibleBookIndex {
  id: string;
  name: string;
  chapters: number;
}

export interface BibleBookPayload {
  id: string;
  name: string;
  chapters: string[][];
}

export interface BibleVerse {
  number: number;
  text: string;
}

const BIBLE_BASE = '/bible/rv1960';
const bookCache = new Map<string, BibleBookPayload>();

export async function listBibleBooks(): Promise<BibleBookIndex[]> {
  const response = await fetch(`${BIBLE_BASE}/index.json`);
  if (!response.ok) throw new Error('No se pudo cargar el índice de la Biblia');
  return (await response.json()) as BibleBookIndex[];
}

export async function loadBibleBook(bookId: string): Promise<BibleBookPayload> {
  const cached = bookCache.get(bookId);
  if (cached) return cached;
  const response = await fetch(`${BIBLE_BASE}/${encodeURIComponent(bookId)}.json`);
  if (!response.ok) throw new Error('No se pudo cargar el libro');
  const payload = (await response.json()) as BibleBookPayload;
  bookCache.set(bookId, payload);
  return payload;
}

export function versesForChapter(book: BibleBookPayload, chapter: number): BibleVerse[] {
  const lines = book.chapters[chapter - 1] ?? [];
  return lines
    .map((text, index) => ({ number: index + 1, text }))
    .filter((verse) => verse.text.length > 0);
}

export function formatVerseLine(bookName: string, chapter: number, verse: BibleVerse): string {
  return `${bookName} ${chapter}:${verse.number} ${verse.text}`;
}

export function formatChapterText(bookName: string, chapter: number, verses: BibleVerse[]): string {
  return verses.map((verse) => formatVerseLine(bookName, chapter, verse)).join('\n');
}

export function formatSelectedVerses(bookName: string, chapter: number, verses: BibleVerse[]): string {
  if (verses.length === 0) return '';
  const ordered = [...verses].sort((a, b) => a.number - b.number);
  if (ordered.length === 1) return formatVerseLine(bookName, chapter, ordered[0]);
  const consecutive = ordered.every(
    (verse, index) => index === 0 || verse.number === ordered[index - 1].number + 1,
  );
  if (consecutive) {
    const first = ordered[0].number;
    const last = ordered[ordered.length - 1].number;
    return [`${bookName} ${chapter}:${first}-${last}`, ...ordered.map((verse) => verse.text)].join('\n');
  }
  return ordered.map((verse) => formatVerseLine(bookName, chapter, verse)).join('\n');
}
