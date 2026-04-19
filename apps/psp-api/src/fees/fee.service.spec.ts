import { FeeService } from './fee.service';

describe('FeeService', () => {
  it('aplica fixed + percentage + minimum con snapshot estable', () => {
    const quote = FeeService.calculate({
      amountMinor: 10_000,
      percentageBps: 100,
      fixedMinor: 20,
      minimumMinor: 0,
    });

    expect(quote).toEqual({
      grossMinor: 10_000,
      feeMinor: 120,
      netMinor: 9_880,
      percentageMinor: 100,
    });
  });

  it('respeta minimum fee cuando percentage+fixed queda por debajo', () => {
    const quote = FeeService.calculate({
      amountMinor: 1_000,
      percentageBps: 50,
      fixedMinor: 10,
      minimumMinor: 90,
    });

    expect(quote.feeMinor).toBe(90);
    expect(quote.netMinor).toBe(910);
  });

  it('topea la comisión al bruto para que netMinor nunca sea negativo', () => {
    const input = {
      amountMinor: 100,
      percentageBps: 0,
      fixedMinor: 0,
      minimumMinor: 500,
    };
    expect(FeeService.uncappedFeeMinor(input)).toBe(500);
    const quote = FeeService.calculate(input);
    expect(quote.feeMinor).toBe(100);
    expect(quote.netMinor).toBe(0);
  });

  it('permite modo gross settlement sin alterar fee calculado', () => {
    const quote = FeeService.calculate({
      amountMinor: 10_000,
      percentageBps: 100,
      fixedMinor: 20,
      minimumMinor: 0,
    });

    expect(quote).toMatchObject({
      grossMinor: 10_000,
      feeMinor: 120,
      netMinor: 9_880,
    });
  });

  it('resolveActiveRateTable devuelve fila vigente para merchant/currency/provider', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'rt_1',
      merchantId: 'm_1',
      currency: 'EUR',
      provider: 'stripe',
      percentageBps: 150,
      fixedMinor: 25,
      minimumMinor: 50,
      settlementMode: 'NET',
    });
    const service = new FeeService({ merchantRateTable: { findFirst } } as never);

    const rate = await service.resolveActiveRateTable('m_1', 'EUR', 'stripe');

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        merchantId: 'm_1',
        currency: 'EUR',
        provider: 'stripe',
        activeTo: null,
      },
      orderBy: { activeFrom: 'desc' },
    });
    expect(rate).toMatchObject({
      id: 'rt_1',
      provider: 'stripe',
      percentageBps: 150,
    });
  });

  it('resolveActiveRateTable lanza cuando no hay tarifa vigente', async () => {
    const service = new FeeService({
      merchantRateTable: { findFirst: jest.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.resolveActiveRateTable('m_1', 'EUR', 'acme')).rejects.toThrow(
      'No active rate table',
    );
  });

  it('findActiveRateTable devuelve null si no hay fila activa', async () => {
    const service = new FeeService({
      merchantRateTable: { findFirst: jest.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.findActiveRateTable('m_1', 'USD', 'stripe')).resolves.toBeNull();
  });

  it('hasActiveRateTableForAnyProvider es true si existe tarifa para algún proveedor', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'rt_1' });
    const service = new FeeService({ merchantRateTable: { findFirst } } as never);

    await expect(
      service.hasActiveRateTableForAnyProvider('m_1', 'EUR', ['stripe', 'mock']),
    ).resolves.toBe(true);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        merchantId: 'm_1',
        currency: 'EUR',
        provider: { in: ['stripe', 'mock'] },
        activeTo: null,
      },
      orderBy: { activeFrom: 'desc' },
    });
  });

  it('hasActiveRateTableForAnyProvider es false con lista de proveedores vacía', async () => {
    const findFirst = jest.fn();
    const service = new FeeService({ merchantRateTable: { findFirst } } as never);

    await expect(service.hasActiveRateTableForAnyProvider('m_1', 'EUR', [])).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
