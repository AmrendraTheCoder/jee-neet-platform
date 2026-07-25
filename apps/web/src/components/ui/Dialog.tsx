import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import './ui.css';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly onClose: () => void;
  /** When false, Escape and backdrop clicks do not close. Used by submit. */
  readonly dismissible?: boolean;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: 'md' | 'lg';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog with a real focus trap.
 *
 * The trap is not polish. The submit confirmation (FR-ATT-04) is the last
 * interaction of a three-hour paper, and a keyboard candidate who tabs out of
 * it into the question behind has no visible way back — they cannot see where
 * focus went, and the deadline is still running.
 */
export function Dialog(props: DialogProps): JSX.Element | null {
  const { open, title, description, onClose, dismissible = true, children, footer } = props;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || panel === null) return;

      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const firstEl = focusable[0];
      const lastEl = focusable.at(-1);
      if (firstEl === undefined || lastEl === undefined) return;

      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`dialog dialog--${props.width ?? 'md'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={-1}
      >
        <header className="dialog__header">
          <h2 id={titleId}>{title}</h2>
          {description === undefined ? null : (
            <p id={descriptionId} className="muted">
              {description}
            </p>
          )}
        </header>
        <div className="dialog__body">{children}</div>
        {footer === undefined ? null : <footer className="dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
}
