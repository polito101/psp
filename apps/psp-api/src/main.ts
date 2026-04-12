import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseCorsAllowedOrigins } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet({ contentSecurityPolicy: false }));
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const corsAllowList = parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS ?? '');
  let corsOrigin: boolean | string[];
  if (corsAllowList.length > 0) {
    corsOrigin = corsAllowList;
  } else if (nodeEnv === 'production') {
    throw new Error(
      'CORS_ALLOWED_ORIGINS is empty in production. This should have failed in env validation.',
    );
  } else {
    corsOrigin = true;
  }
  app.enableCors({ origin: corsOrigin });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  if (process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('PSP Gateway API')
      .setDescription('Single API REST para comercios: payment links, pagos, ledger y webhooks.')
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'ApiKey')
      .addApiKey({ type: 'apiKey', name: 'X-Internal-Secret', in: 'header' }, 'InternalSecret')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
