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
});
