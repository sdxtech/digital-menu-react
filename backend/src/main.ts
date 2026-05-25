import { ConfigService } from '@nestjs/config';
import { createNestApp } from './bootstrap';

async function bootstrap() {
  const app = await createNestApp();
  app.enableShutdownHooks();
  const config = app.get(ConfigService);

  const port = Number(config.getOrThrow<string>('PORT'));
  await app.listen(port);
}
void bootstrap();
