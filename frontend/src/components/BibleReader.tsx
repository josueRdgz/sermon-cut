import { useEffect, useMemo, useRef, useState } from 'react';

import {
  formatChapterText,
  formatSelectedVerses,
  listBibleBooks,
  loadBibleBook,
  versesForChapter,
  type BibleBookIndex,
  type BibleBookPayload,
} from '../api/bible';
import { Button } from './ui/Button';
import styles from './BibleReader.module.css';

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function citationLabel(bookName: string, chapter: number, numbers: number[]): string {
  if (numbers.length === 0) return `${bookName} ${chapter}`;
  if (numbers.length === 1) return `${bookName} ${chapter}:${numbers[0]}`;
  const consecutive = numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
  if (consecutive) return `${bookName} ${chapter}:${numbers[0]}-${numbers[numbers.length - 1]}`;
  return `${bookName} ${chapter}:${numbers.join(', ')}`;
}

export function BibleReader() {
  const [books, setBooks] = useState<BibleBookIndex[]>([]);
  const [bookId, setBookId] = useState('JHN');
  const [chapter, setChapter] = useState(3);
  const [book, setBook] = useState<BibleBookPayload | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const anchorRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listBibleBooks()
      .then((items) => {
        if (!cancelled) setBooks(items);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar la Biblia');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    anchorRef.current = null;
    void loadBibleBook(bookId)
      .then((payload) => {
        if (cancelled) return;
        setBook(payload);
        const maxChapter = payload.chapters.length;
        setChapter((current) => Math.min(Math.max(1, current), maxChapter));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar el libro');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const verses = useMemo(
    () => (book ? versesForChapter(book, chapter) : []),
    [book, chapter],
  );
  const bookName = book?.name ?? books.find((item) => item.id === bookId)?.name ?? '';
  const chapterCount = book?.chapters.length ?? books.find((item) => item.id === bookId)?.chapters ?? 1;
  const selectedVerses = useMemo(
    () => verses.filter((verse) => selected.has(verse.number)),
    [verses, selected],
  );

  function clearSelection() {
    setSelected(new Set());
    anchorRef.current = null;
  }

  function toggleVerse(number: number, range: boolean) {
    setSelected((current) => {
      if (range && anchorRef.current != null) {
        const from = Math.min(anchorRef.current, number);
        const to = Math.max(anchorRef.current, number);
        return new Set(verses.filter((verse) => verse.number >= from && verse.number <= to).map((verse) => verse.number));
      }
      const next = new Set(current);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
    if (!range) anchorRef.current = number;
    setNotice(null);
  }

  async function copySelection() {
    const ok = await copyText(formatSelectedVerses(bookName, chapter, selectedVerses));
    const numbers = selectedVerses.map((verse) => verse.number);
    setNotice(ok ? `Copiado ${citationLabel(bookName, chapter, numbers)}` : 'No se pudo copiar');
  }

  async function copyChapter() {
    const ok = await copyText(formatChapterText(bookName, chapter, verses));
    setNotice(ok ? `Copiado ${bookName} ${chapter}` : 'No se pudo copiar');
  }

  return (
    <div className={styles.root}>
      <p className={styles.intro}>
        Elige libro y capítulo, marca uno o varios versículos y cópialos para pegarlos como capa en el
        editor.
      </p>
      <div className={styles.controls}>
        <label className={styles.field}>
          Libro
          <select
            value={bookId}
            onChange={(event) => {
              setBookId(event.target.value);
              setChapter(1);
              setNotice(null);
            }}
          >
            {(books.length > 0 ? books : [{ id: bookId, name: bookName || bookId, chapters: chapterCount }]).map(
              (item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ),
            )}
          </select>
        </label>
        <label className={styles.field}>
          Capítulo
          <select
            value={chapter}
            onChange={(event) => {
              setChapter(Number(event.target.value));
              clearSelection();
              setNotice(null);
            }}
          >
            {Array.from({ length: chapterCount }, (_, index) => index + 1).map((number) => (
              <option key={number} value={number}>
                {number}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => void copySelection()} disabled={selectedVerses.length === 0}>
            {selectedVerses.length === 0
              ? 'Copiar selección'
              : selectedVerses.length === 1
                ? 'Copiar 1 versículo'
                : `Copiar ${selectedVerses.length} versículos`}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void copyChapter()} disabled={verses.length === 0}>
            Copiar capítulo
          </Button>
        </div>
      </div>
      {loading ? <p className={`${styles.status} muted`}>Cargando…</p> : null}
      {error ? <p className={`${styles.status} error`}>{error}</p> : null}
      {notice ? <p className={`${styles.status} muted`}>{notice}</p> : null}
      {!loading && !error ? (
        <div className={styles.verses} role="listbox" aria-multiselectable="true" aria-label={`${bookName} ${chapter}`}>
          {verses.map((verse) => {
            const isSelected = selected.has(verse.number);
            return (
              <button
                key={verse.number}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`${styles.verse} ${isSelected ? styles.selected : ''}`}
                onClick={(event) => toggleVerse(verse.number, event.shiftKey)}
              >
                <span className={styles.number}>{verse.number}</span>
                <span className={styles.text}>{verse.text}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
