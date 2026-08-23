import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { AiAgentService } from '../ai-agent/ai-agent.service';
import { validateEnvironment } from '../common/env.validator';

async function main(): Promise<void> {
  validateEnvironment(process.env);
  const logger = new Logger('AgentOnce');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const processed = await app.get(AiAgentService).runCycleForAllAccounts();
    logger.log(`AI cycle executed for ${processed} account(s)`);
  } finally {
    await app.close();
  }
}

void main();
