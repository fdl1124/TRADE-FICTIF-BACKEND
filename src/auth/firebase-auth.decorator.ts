import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FirebaseUserPayload } from './firebase.service';

export const CurrentUser = createParamDecorator(
  (data: unknown, context: ExecutionContext): FirebaseUserPayload => {
    const request = context.switchToHttp().getRequest();
    const user = request.user as FirebaseUserPayload | undefined;
    if (!user || typeof user.uid !== 'string') {
      throw new Error('CurrentUser used outside of FirebaseAuthGuard protection');
    }
    return user;
  },
);

export type { FirebaseUserPayload };
