import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface NleMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  items?: NleMenuItem[];
  danger?: boolean;
  onSelect?: () => void;
}

interface NleContextMenuProps {
  x: number;
  y: number;
  items: NleMenuItem[];
  onClose: () => void;
}

const OFFSET = 4;
const EDGE = 8;

export function NleContextMenu({ x, y, items, onClose }: NleContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + OFFSET, top: y + OFFSET });

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const maxLeft = Math.max(EDGE, window.innerWidth - width - EDGE);
    const maxTop = Math.max(EDGE, window.innerHeight - height - EDGE);
    let left = x + OFFSET;
    let top = y + OFFSET;
    if (left > maxLeft) left = Math.max(EDGE, x - width - OFFSET);
    if (top > maxTop) top = Math.max(EDGE, y - height - OFFSET);
    setPos({
      left: Math.min(maxLeft, Math.max(EDGE, left)),
      top: Math.min(maxTop, Math.max(EDGE, top)),
    });
  }, [x, y, items]);

  useEffect(() => {
    let armed = false;
    const arm = window.setTimeout(() => {
      armed = true;
    }, 0);
    function handlePointer(event: Event) {
      if (!armed) return;
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('pointerdown', handlePointer, true);
    window.addEventListener('mousedown', handlePointer, true);
    window.addEventListener('click', handlePointer, true);
    window.addEventListener('contextmenu', handlePointer, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.clearTimeout(arm);
      window.removeEventListener('pointerdown', handlePointer, true);
      window.removeEventListener('mousedown', handlePointer, true);
      window.removeEventListener('click', handlePointer, true);
      window.removeEventListener('contextmenu', handlePointer, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      className="nle-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) =>
        item.items && item.items.length > 0 ? (
          <div key={item.id} className="nle-menu__sub">
            <span className="nle-menu__item nle-menu__item--parent">{item.label}</span>
            <div className="nle-menu nle-menu--nested" role="menu">
              {item.items.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  role="menuitem"
                  className={`nle-menu__item${child.danger ? ' nle-menu__item--danger' : ''}`}
                  disabled={child.disabled}
                  onClick={() => {
                    if (child.disabled) return;
                    child.onSelect?.();
                    onClose();
                  }}
                >
                  {child.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`nle-menu__item${item.danger ? ' nle-menu__item--danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect?.();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
