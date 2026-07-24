import { X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import styles from './Modal.module.css';

interface ModalProps {
  title: string;
  icon?: LucideIcon;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, icon: Icon, onClose, children }: ModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {Icon ? <Icon size={17} strokeWidth={2} aria-hidden /> : null}
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
