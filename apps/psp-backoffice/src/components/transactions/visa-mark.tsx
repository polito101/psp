import { cn } from "@/lib/utils";

/** Marca simplificada tipo Visa (no es el logotipo oficial registrado). */
export function VisaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 16"
      className={cn("h-3 w-9 shrink-0", className)}
      aria-hidden
    >
      <rect width="48" height="16" rx="2" fill="#1A1F71" />
      <text
        x="24"
        y="11"
        textAnchor="middle"
        fill="#fff"
        fontSize="9"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        VISA
      </text>
    </svg>
  );
}
