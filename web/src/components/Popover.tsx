import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The button that toggles the popover; the panel opens below it. */
  button: ReactNode;
  label: string;
  className?: string;
  children: ReactNode;
}

/** A panel anchored below its button, closed by Escape or a click outside. */
export default function Popover({ open, onClose, button, label, className = '', children }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [alignEnd, setAlignEnd] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  // Open towards the left when the panel would run off the right edge of the window.
  useLayoutEffect(() => {
    if (!open) return setAlignEnd(false);
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect && rect.right > window.innerWidth - 8) setAlignEnd(true);
  }, [open]);

  return (
    <div className="popover-anchor" ref={rootRef}>
      {button}
      {open && (
        <div ref={panelRef} className={`popover${alignEnd ? ' align-end' : ''} ${className}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
