import { Global, Module } from '@nestjs/common';
import { FirebaseService } from './firebase.service';
import { FirebaseAuthGuard } from './firebase-auth.guard';

@Global()
@Module({
  providers: [FirebaseService, FirebaseAuthGuard],
  exports: [FirebaseService, FirebaseAuthGuard],
})
export class AuthModule {}
