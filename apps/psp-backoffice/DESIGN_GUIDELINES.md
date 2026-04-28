# PSP Backoffice — Guía de diseño

Documento de referencia para mantener una identidad visual coherente, profesional y moderna
(estilo SaaS premium) en todo el backoffice. Aplicar estas reglas a nuevas vistas y
refactors visuales.

> Regla de oro: **nunca** modificar lógica, handlers, imports, rutas, llamadas API,
> estados ni nombres de variables al hacer cambios visuales. Si hay duda entre diseño y
> lógica, **no se toca la lógica**.

---

## 1. Sistema de color

Paleta limitada (3–5 colores). No usar morados/violetas a menos que se pidan.

- **Primario de marca**: `var(--primary)` (definido por la app, mantener tal cual).
- **Neutros**: `slate-50`, `slate-100`, `slate-200`, `slate-300`, `slate-500`,
  `slate-600`, `slate-700`, `slate-900`. Blanco puro para superficies de cards.
- **Acento oscuro**: gradientes `from-slate-900 via-slate-900 to-slate-800` para paneles
  hero/aside.
- **Estados**:
  - Error: `red-50` / `red-200` / `red-500` / `red-700`.
  - Éxito: `emerald-50` / `emerald-200` / `emerald-600`.
  - Aviso: `amber-50` / `amber-200` / `amber-600`.
- **Decorativos sutiles**: blobs `bg-[var(--primary)]/10` y `bg-sky-200/40` con
  `blur-3xl`. Solo como fondo, nunca como elemento principal.

### Reglas
- Si cambias `bg-*` también ajusta `text-*` para mantener contraste AA.
- Evitar gradientes en elementos primarios. Solo aceptables como acentos sutiles y con
  colores análogos.
- No usar `bg-white`/`text-black` directos cuando exista un token equivalente.

---

## 2. Tipografía

Máximo dos familias: `font-sans` (Inter) y `font-mono` (Geist Mono).

- Títulos de página: `text-2xl` o `text-3xl`, `font-semibold`, `tracking-tight`,
  `text-balance`.
- Subtítulos / secciones: `text-lg` `font-semibold`.
- Cuerpo: `text-sm`, `leading-relaxed` (`leading-6`), `text-slate-600` o
  `text-slate-700`.
- Captions / metadatos: `text-xs`, `text-slate-500`.
- Labels de formulario: `text-sm font-medium text-slate-700`.
- IDs / tokens / código inline: `font-mono`, `text-[11px]` o `text-xs`,
  `rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5`.
- Usar `text-balance` en titulares y `text-pretty` en párrafos largos.

---

## 3. Layout y espaciado

- Mobile-first. Layouts con **flexbox** por defecto; **grid** sólo cuando sea 2D real.
- Usar la escala de Tailwind. **No** usar valores arbitrarios `p-[16px]`. Preferir
  `p-4`, `p-6`, `p-8`.
- Espaciado entre items con `gap-*`, no con `space-*` ni mezclando margin/padding con
  gap.
- Contenedor principal del backoffice: `max-w-[1400px]` (ya gestionado por `AppShell`).
- Cards / paneles: padding interno `p-6` en móvil, `sm:p-8` en pantallas mayores.
- Formularios: separación vertical `space-y-5` entre campos; `space-y-1.5` entre label
  e input.

---

## 4. Componentes y patrones visuales

### 4.1 Cards / superficies
```
rounded-2xl border border-slate-200/80 bg-white/90 p-6 sm:p-8
shadow-xl shadow-slate-900/5 ring-1 ring-black/[0.02] backdrop-blur-sm
```
- Radio: `rounded-2xl` para contenedores grandes, `rounded-xl` para cards medianos,
  `rounded-lg` para inputs y botones.
- Sombras suaves y de baja opacidad. Nunca sombras duras.

### 4.2 Inputs
```
block w-full rounded-lg border border-slate-300 bg-white py-2.5 px-3
text-sm text-slate-900 shadow-sm transition-all
placeholder:text-slate-400
hover:border-slate-400
focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/15
disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500
```
- Si el input lleva icono, usar `pl-10` y un `<span>` absoluto con
  `text-slate-400 group-focus-within:text-[var(--primary)]` (envolver en
  `<div className="group relative">`).
- Inputs con datos técnicos (IDs, tokens): clase `font-mono`, placeholder en
  `placeholder:font-sans`.

### 4.3 Botones primarios
```
inline-flex items-center justify-center gap-2 rounded-lg
bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white
shadow-sm shadow-[var(--primary)]/20 transition-all
hover:brightness-110 hover:shadow-md hover:shadow-[var(--primary)]/25
focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/30
active:brightness-95
disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100
```
- Estado pending: spinner `<Loader2 className="animate-spin" />` + texto.
- Microinteracción: icono final con `transition-transform group-hover:translate-x-0.5`.

### 4.4 Botones secundarios / ghost
```
inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white
px-3 py-1.5 text-sm font-medium text-slate-700
hover:bg-slate-50 hover:border-slate-300
focus:outline-none focus:ring-4 focus:ring-slate-900/5
```

### 4.5 Segmented control (radio group estilizado)
- Wrapper: `grid grid-cols-N gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-1`.
- Item activo: `bg-white text-slate-900 shadow-sm ring-1 ring-slate-200`.
- Item inactivo: `text-slate-600 hover:text-slate-900`.
- Input nativo `sr-only`, label clicable contiene icono + texto.

### 4.6 Mensajes de error / alerta
```
flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50
px-3.5 py-3 text-sm text-red-700
```
Con `<AlertCircle />` icono `text-red-500` y `role="alert"`.

### 4.7 Badges / chips
```
inline-flex items-center gap-1 rounded-full border border-slate-200
bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600
```

---

## 5. Iconografía

- Librería: **lucide-react** (ya en uso).
- Tamaños estándar: `16` (inline / inputs / botones), `20` (cards), `24` (heros).
- Siempre con `aria-hidden` cuando son decorativos.
- Color por defecto: `text-slate-400` o `text-slate-500`. En estados activos/focus,
  `text-[var(--primary)]`.
- **No** usar emojis como iconos.

---

## 6. Estados y microinteracciones

- Hover, focus y disabled deben ser **explícitos** en todo control interactivo.
- Transiciones: `transition-all` con duración por defecto. Evitar animaciones largas.
- Focus visible obligatorio: `focus:ring-4` con color/opacidad acorde al elemento.
- Loading: deshabilitar el control y mostrar spinner `<Loader2 className="animate-spin" />`.
- Skeletons (cuando sea necesario): `animate-pulse rounded-lg bg-slate-100`.

---

## 7. Responsive

- Mobile-first. Breakpoints: `sm` (640), `md` (768), `lg` (1024), `xl` (1280).
- Layouts de dos columnas (form + branding) usar `lg:grid-cols-[...]`. En móvil
  ocultar el panel decorativo (`hidden lg:flex`).
- Padding de cards: `p-6` móvil → `sm:p-8` en pantallas mayores.
- Tipografía: títulos `text-2xl` móvil → `lg:text-3xl` desktop.

---

## 8. Accesibilidad

- HTML semántico: `<main>`, `<header>`, `<nav>`, `<section>`, `<fieldset>`/`<legend>`.
- Cada input con `<label htmlFor>`. Iconos decorativos con `aria-hidden`.
- Contraste mínimo AA. Texto sobre fondos oscuros: `text-slate-100` o blanco.
- `role="alert"` en mensajes de error.
- `role="radiogroup"` en grupos de radio personalizados.
- Texto solo para lectores: `sr-only` (no remover inputs nativos al estilizar; usar
  `sr-only` sobre el input y estilizar el `<label>`).

---

## 9. Background y decoraciones

- Fondo de página gestionado por `AppShell` (`bg-slate-50`). No cambiar.
- En vistas hero/login, decorar con blobs sutiles `blur-3xl` y un patrón de puntos:
  ```
  backgroundImage:
    "radial-gradient(circle at 1px 1px, rgba(15, 23, 42, 0.08) 1px, transparent 0)",
  backgroundSize: "22px 22px",
  ```
- Glassmorphism sutil con `bg-white/90 backdrop-blur-sm` sobre fondos decorados.
- **Nunca** usar gradientes circulares/blobs como elementos principales, solo de fondo.

---

## 10. Qué **no** hacer

- No tocar lógica, estados, handlers, imports funcionales o llamadas API al rediseñar.
- No usar morados/violetas como color principal.
- No usar emojis como iconos.
- No usar valores arbitrarios `p-[16px]`, `text-[15px]`, etc., salvo casos justificados.
- No mezclar `space-y-*` con `gap-*` ni `margin` con `gap` en el mismo elemento.
- No generar SVGs decorativos a mano (blobs, mapas, etc.). Usar librerías o imágenes.
- No introducir nuevas familias tipográficas.
