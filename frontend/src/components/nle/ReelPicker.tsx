import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

interface ReelPickerItem {
  id: string;
  title: string;
}

interface ReelPickerProps {
  items: ReelPickerItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}

export function ReelPicker({
  items,
  value,
  onChange,
  label = 'Reel en edición',
}: ReelPickerProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState({ left: 0, top: 0, width: 280 });
  const listId = useId();
  const selected = items.find((item) => item.id === value) ?? items[0] ?? null;
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );

  useEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    if (button) {
      const rect = button.getBoundingClientRect();
      const width = Math.min(420, Math.max(rect.width, 240));
      const left = Math.min(
        window.innerWidth - width - 8,
        Math.max(8, rect.left + rect.width - width),
      );
      setMenuBox({ left, top: rect.bottom + 6, width });
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function choose(id: string) {
    setOpen(false);
    if (id !== value) onChange(id);
  }

  return (
    <div className="reel-nle__reel-picker">
      <span className="visually-hidden">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className="reel-nle__reel-picker-button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="reel-nle__reel-picker-value">
          {selected ? `${selectedIndex + 1}. ${selected.title}` : 'Elegir propuesta'}
        </span>
        <ChevronDown size={16} strokeWidth={2} aria-hidden className="reel-nle__reel-picker-icon" />
      </button>
      {open &&
        createPortal(
          <ul
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="reel-nle__reel-picker-menu"
            style={{ left: menuBox.left, top: menuBox.top, width: menuBox.width }}
          >
            {items.map((item, index) => {
              const active = item.id === value;
              return (
                <li key={item.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`reel-nle__reel-picker-option${
                      active ? ' reel-nle__reel-picker-option--active' : ''
                    }`}
                    onClick={() => choose(item.id)}
                  >
                    <em>{index + 1}</em>
                    <span>{item.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
