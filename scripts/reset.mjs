import { execSync } from 'child_process';

try {
  console.log('[v0] Descartando cambios...');
  execSync('git reset --hard HEAD', { cwd: '/vercel/share/v0-project', stdio: 'inherit' });
  console.log('[v0] Cambios descartados exitosamente');
} catch (error) {
  console.error('[v0] Error:', error.message);
  process.exit(1);
}
