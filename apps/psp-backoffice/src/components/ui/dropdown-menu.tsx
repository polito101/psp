"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const MenuCloseContext = React.createContext<() => void>(() => {});

export type DropdownMenuProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
};

/**
 * Menú desplegable mínimo (sin Radix): posicionamiento relativo al trigger y cierre al click fuera.
 */
export function DropdownMenu({ trigger, children, align = "end" }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => setOpen(false), []);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <MenuCloseContext.Provider value={close}>
      <div ref={rootRef} className="relative inline-flex">
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
        >
          {trigger}
        </button>
        {open ? (
          <div
            role="menu"
            className={cn(
              "absolute z-50 mt-1 min-w-[10rem] rounded-lg border border-[#e3e8ee] bg-white py-1 shadow-lg",
              align === "end" ? "right-0" : "left-0",
            )}
          >
            {children}
          </div>
        ) : null}
      </div>
    </MenuCloseContext.Provider>
  );
}

export function DropdownMenuItem({
  className,
  disabled,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const close = React.useContext(MenuCloseContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        close();
      }}
    />
  );
}
