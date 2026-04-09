import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { PaymentsService } from '../payments/payments.service';

/**
 * Checkout alojado por el PSP (HTML mínimo para MVP).
 * En producción: SPA + integración Stripe.js / redirect según PCI-SCOPE.
 */
@ApiExcludeController()
@Controller({ path: 'pay', version: '1' })
export class CheckoutController {
  constructor(
    private readonly links: PaymentLinksService,
    private readonly payments: PaymentsService,
  ) {}

  @Get(':slug')
  async payPage(@Param('slug') slug: string, @Res() res: Response) {
    const link = await this.links.findBySlug(slug);
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pagar — ${link.merchant.name}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 2rem auto; padding: 0 1rem; }
    button { padding: 0.75rem 1rem; font-size: 1rem; cursor: pointer; }
    .muted { color: #555; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>${link.merchant.name}</h1>
  <p class="muted">Importe: <strong>${(link.amountMinor / 100).toFixed(2)} ${link.currency}</strong></p>
  <p class="muted">MVP: sin PAN en este servidor; la captura simula el adquirente sandbox.</p>
  <form method="post" action="/api/v1/pay/${link.slug}/submit">
    <button type="submit">Pagar ahora</button>
  </form>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  @Post(':slug/submit')
  async submit(@Param('slug') slug: string, @Res() res: Response) {
    await this.payments.completePayByLinkSlug(slug);
    return res.redirect(303, `/api/v1/pay/${slug}/done`);
  }

  @Get(':slug/done')
  done(@Res() res: Response) {
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>Pago completado</title></head>
<body><p>Pago completado. El comercio recibirá un webhook si configuró una URL.</p></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
}

