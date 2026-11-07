import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Останавливаем сервер');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Ошибка при остановке сервера');
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error({ err: error }, 'Не удалось запустить сервер');
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
