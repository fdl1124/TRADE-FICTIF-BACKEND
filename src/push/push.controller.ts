import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CurrentUser } from '../auth/firebase-auth.decorator';
import { FirebaseUserPayload } from '../auth/firebase.service';
import { AccountService } from '../portfolio/account.service';
import { PushService } from './push.service';

@Controller('api/push/tokens')
@UseGuards(FirebaseAuthGuard)
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly accounts: AccountService,
  ) {}

  @Post()
  async register(
    @CurrentUser() user: FirebaseUserPayload,
    @Body() dto: { token?: string; platform?: string },
  ): Promise<{ registered: true }> {
    const token = String(dto.token ?? '').trim();
    if (token.length < 20) {
      throw new Error('token requis');
    }
    const accountId = await this.accounts.getOrCreateAccountId(user);
    const platform = ['web', 'android', 'ios'].includes(String(dto.platform)) ? String(dto.platform) : 'web';
    await this.push.registerToken(accountId, token, platform);
    return { registered: true };
  }

  @Get()
  async list(@CurrentUser() user: FirebaseUserPayload): Promise<{ count: number }> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    const tokens = await this.push.listTokens(accountId);
    return { count: tokens.length };
  }

  @Delete()
  async unregister(@CurrentUser() user: FirebaseUserPayload, @Body() dto: { token?: string }): Promise<{ deleted: true }> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    await this.push.removeToken(accountId, String(dto.token ?? ''));
    return { deleted: true };
  }
}
