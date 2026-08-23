import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ApiError } from '../interfaces';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    if (exception instanceof ThrottlerException) {
      const body: ApiError = {
        error: 'RATE_LIMITED',
        message: 'Too many requests, slow down',
      };
      response.status(HttpStatus.TOO_MANY_REQUESTS).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        Array.isArray((payload as Record<string, unknown>).message)
      ) {
        const messages = (payload as Record<string, unknown>).message as string[];
        const body: ApiError = {
          error: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: messages,
        };
        response.status(status).json(body);
        return;
      }
      const body: ApiError =
        typeof payload === 'object' && payload !== null && 'error' in payload && 'message' in payload
          ? (payload as ApiError)
          : { error: 'HTTP_ERROR', message: exception.message };
      response.status(status).json(body);
      return;
    }

    this.logger.error(
      `Unhandled error on ${request?.method ?? 'UNKNOWN'} ${request?.url ?? 'UNKNOWN'}: ${
        exception instanceof Error ? exception.message : String(exception)
      }`,
    );
    const body: ApiError = {
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
