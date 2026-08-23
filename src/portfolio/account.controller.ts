import { Controller, Get, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CurrentUser } from '../auth/firebase-auth.decorator';
import { FirebaseUserPayload } from '../auth/firebase.service';
import { AccountService } from './account.service';
import { Account, AccountSummary } from '../common/interfaces';

@Controller('api/account')
@UseGuards(FirebaseAuthGuard)
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Get()
  async getAccount(@CurrentUser() user: FirebaseUserPayload): Promise<Account> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.accounts.getAccount(accountId);
  }

  @Get('summary')
  async getSummary(@CurrentUser() user: FirebaseUserPayload): Promise<AccountSummary> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.accounts.getSummary(accountId);
  }
}
