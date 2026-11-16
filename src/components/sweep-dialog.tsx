'use client';

import {useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject} from 'react';

type SweepDialogProps = {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onRequestClose: () => void;
  dismissible?: boolean;
  closeLabel?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

let scrollLocks = 0;
let previousBodyOverflow = '';

function lockBodyScroll() {
  if (scrollLocks++ === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  return () => {
    if (--scrollLocks === 0) document.body.style.overflow = previousBodyOverflow;
  };
}

function tabStops(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(
    'a[href], area[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]',
  )].filter(element => element instanceof HTMLElement && element.tabIndex >= 0
    && !element.matches(':disabled') && !element.closest('[inert]')
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}

/**
 * Controlled presentation only. Closing never changes a transaction or journal.
 * Native showModal supplies the inert background; the whole header and content
 * scroll together, leaving the action footer reachable on short viewports.
 */
export function SweepDialog({
  open, title, description, leading, children, footer, onRequestClose,
  dismissible = true, closeLabel = 'Close dialog', returnFocusRef,
}: SweepDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const titleId = `sweep-dialog-title-${id}`;
  const descriptionId = `sweep-dialog-description-${id}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    const active = document.activeElement;
    const opener = returnFocusRef?.current
      ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    if (!dialog.open) dialog.showModal();
    const unlock = lockBodyScroll();
    titleRef.current?.focus({preventScroll: true});
    return () => {
      if (dialog.open) dialog.close();
      unlock();
      if (scrollLocks > 0) return;
      const target = opener?.isConnected && opener.getClientRects().length > 0
        && !opener.matches(':disabled') && !opener.closest('[inert]')
        ? opener : document.getElementById('main-content');
      target?.focus({preventScroll: true});
    };
  }, [open, returnFocusRef]);

  const containTab = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const stops = tabStops(event.currentTarget);
    const index = stops.indexOf(document.activeElement as HTMLElement);
    if (!stops.length) {
      event.preventDefault();
      titleRef.current?.focus({preventScroll: true});
    } else if (event.shiftKey && index <= 0) {
      event.preventDefault();
      stops[stops.length - 1].focus();
    } else if (!event.shiftKey && (index < 0 || index === stops.length - 1)) {
      event.preventDefault();
      stops[0].focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="sweep-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={containTab}
      onCancel={event => {
        event.preventDefault();
        if (dismissible) onRequestClose();
      }}
    >
      <div className="sweep-dialog-scroll">
        <header className="sweep-dialog-header">
          <div className="sweep-dialog-heading">
            {leading && <div className="sweep-dialog-leading" aria-hidden="true">{leading}</div>}
            <div className="sweep-dialog-heading-text">
              <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
              {description && <p id={descriptionId}>{description}</p>}
            </div>
          </div>
          <button
            type="button"
            className="sweep-dialog-close"
            aria-label={closeLabel}
            disabled={!dismissible}
            onClick={onRequestClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18"/>
            </svg>
          </button>
        </header>
        <div className="sweep-dialog-body">{children}</div>
      </div>
      {footer && <footer className="sweep-dialog-footer">{footer}</footer>}
    </dialog>
  );
}
