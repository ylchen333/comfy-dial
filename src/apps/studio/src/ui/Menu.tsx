import { useEffect, useRef, useState, type ReactNode } from "react";

/** A header dropdown like Blender's View / Overlays menus: opens on click, closes on an outside click or Esc. */
export function Menu({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="menu" ref={box}>
      <button type="button" className={open ? "on" : ""} aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)}>{label} <span aria-hidden>&#9662;</span></button>
      {open && <div className="menu-pop" role="menu" onClick={(e) => { if ((e.target as HTMLElement).closest("[data-close]")) setOpen(false); }}>{children}</div>}
    </div>
  );
}

/** A menu row: label on the left, shortcut on the right. Clicking it runs the action and closes the menu. */
export function MenuItem({ label, keys, onClick }: { label: string; keys?: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" data-close className="mi" onClick={onClick}>
      <span>{label}</span>{keys && <kbd>{keys}</kbd>}
    </button>
  );
}
