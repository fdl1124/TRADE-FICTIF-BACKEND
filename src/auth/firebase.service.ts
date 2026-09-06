import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceAccount, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import type { Messaging } from 'firebase-admin/messaging';
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
  private messaging: Messaging | null = null;

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
    this.messaging = getMessaging(app);
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

  /** Envoie une notification web push. Renvoie les tokens morts a purger. */
  async sendPushToTokens(
    tokens: string[],
    title: string,
    body: string,
    url = '/',
  ): Promise<{ sent: number; deadTokens: string[] }> {
    if (!this.messaging || tokens.length === 0) {
      return { sent: 0, deadTokens: [] };
    }
    try {
      const response = await this.messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        webpush: {
          notification: { icon: '/icon.svg', badge: '/icon.svg' },
          fcmOptions: { link: url },
        },
      });
      const deadTokens: string[] = [];
      response.responses.forEach((r, i) => {
        const code = r.error?.code ?? '';
        if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) {
          deadTokens.push(tokens[i]);
        }
      });
      return { sent: response.successCount, deadTokens };
    } catch (error) {
      this.logger.warn(
        `Push send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { sent: 0, deadTokens: [] };
    }
  }
}
