"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Diálogo accesible basado en `<dialog>` nativo (showModal/close).
 */
export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    }
    if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cn(
        "w-[min(100vw-2rem,28rem)] max-h-[min(90vh,32rem)] overflow-y-auto rounded-xl border border-[#e3e8ee] bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/20",
        className,
      )}
      onClose={() => onOpenChange(false)}
      onCancel={(e) => {
        e.preventDefault();
        onOpenChange(false);
      }}
    >
      <div className="border-b border-[#e3e8ee] px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
