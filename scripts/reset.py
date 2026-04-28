#!/usr/bin/env python3
import subprocess
import sys

try:
    # Descartar todos los cambios locales
    result = subprocess.run(['git', 'reset', '--hard', 'HEAD'], cwd='/vercel/share/v0-project', capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(f"Error: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    print("[v0] Cambios descartados exitosamente")
except Exception as e:
    print(f"Error ejecutando git reset: {e}", file=sys.stderr)
    sys.exit(1)
