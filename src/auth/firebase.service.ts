import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceAccount, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import { ApiErrors } from '../common/api-error';

export interface FirebaseUserPayload {
  uid: string;
  email: string | null;
  name: string | null;
}

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private auth: Auth | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.getOrThrow<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    let credentials: ServiceAccount;
    try {
      credentials = JSON.parse(raw) as ServiceAccount;
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
    const app = getApps().length > 0 ? getApp() : initializeApp({ credential: cert(credentials) });
    this.auth = getAuth(app);
    this.logger.log('Firebase Admin initialized');
  }

  async verifyIdToken(token: string): Promise<FirebaseUserPayload> {
    if (!this.auth) {
      throw ApiErrors.unauthorized('Authentication service is not ready');
    }
    try {
      const decoded = await this.auth.verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        email: typeof decoded.email === 'string' ? decoded.email : null,
        name: typeof decoded.name === 'string' ? decoded.name : null,
      };
    } catch {
      throw ApiErrors.unauthorized('Invalid or expired Firebase ID token');
    }
  }

  async deleteUser(uid: string): Promise<void> {
    if (!this.auth) {
      throw ApiErrors.unauthorized('Authentication service is not ready');
    }
    await this.auth.deleteUser(uid);
  }
}
