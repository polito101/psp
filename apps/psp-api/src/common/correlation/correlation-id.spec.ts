import { readIncomingCorrelationId, normalizeCorrelationIdOrGenerate } from './correlation-id';

describe('correlation-id', () => {
  describe('readIncomingCorrelationId', () => {
    it('prefiere x-request-id sobre x-correlation-id', () => {
      expect(
        readIncomingCorrelationId({
          'x-request-id': 'a',
          'x-correlation-id': 'b',
        }),
      ).toBe('a');
    });

    it('usa x-correlation-id si no hay x-request-id', () => {
      expect(readIncomingCorrelationId({ 'x-correlation-id': 'c-only' })).toBe('c-only');
    });

    it('toma la primera entrada si la cabecera viene duplicada (array)', () => {
      expect(readIncomingCorrelationId({ 'x-request-id': ['first', 'second'] })).toBe('first');
    });
  });

  describe('normalizeCorrelationIdOrGenerate', () => {
    it('devuelve el candidato válido', () => {
      expect(normalizeCorrelationIdOrGenerate('my-trace-1')).toBe('my-trace-1');
    });

    it('genera UUID si el candidato supera la longitud máxima', () => {
      const long = 'x'.repeat(200);
      const out = normalizeCorrelationIdOrGenerate(long);
      expect(out).not.toBe(long);
      expect(out).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('genera UUID si hay caracteres no ASCII imprimibles', () => {
      const out = normalizeCorrelationIdOrGenerate('bad\nid');
      expect(out).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });
});
