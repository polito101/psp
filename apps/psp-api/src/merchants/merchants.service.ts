import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { encryptUtf8 } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: { name: string; webhookUrl?: string }) {
    const webhookSecretPlain = `whsec_${randomBytes(24).toString('base64url')}`;
    const webhookSecretCiphertext = encryptUtf8(webhookSecretPlain);
    const placeholderHash = await bcrypt.hash(randomBytes(16).toString('hex'), 12);

    const merchant = await this.prisma.merchant.create({
      data: {
        name: dto.name,
        apiKeyHash: placeholderHash,
        webhookUrl: dto.webhookUrl ?? null,
        webhookSecretCiphertext,
      },
    });

    const apiKeyPlain = `psp.${merchant.id}.${randomBytes(32).toString('base64url')}`;
    const apiKeyHash = await bcrypt.hash(apiKeyPlain, 12);
    await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: { apiKeyHash },
    });

    return {
      id: merchant.id,
      name: merchant.name,
      apiKey: apiKeyPlain,
      webhookSecret: webhookSecretPlain,
      message:
        'Guarda apiKey y webhookSecret de forma segura; no se volverán a mostrar.',
    };
  }
}
