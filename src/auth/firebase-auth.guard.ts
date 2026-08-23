import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { FirebaseService, FirebaseUserPayload } from './firebase.service';
import { ApiErrors } from '../common/api-error';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: unknown = request.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw ApiErrors.unauthorized('Missing Authorization: Bearer <firebase_id_token> header');
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      throw ApiErrors.unauthorized('Empty bearer token');
    }
    const user: FirebaseUserPayload = await this.firebase.verifyIdToken(token);
    request.user = user;
    return true;
  }
}
