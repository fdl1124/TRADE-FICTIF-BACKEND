import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CurrentUser } from '../auth/firebase-auth.decorator';
import { FirebaseUserPayload } from '../auth/firebase.service';
import { AccountService } from './account.service';
import { PositionsService } from './positions.service';
import { Position } from '../common/interfaces';

@Controller('api/positions')
@UseGuards(FirebaseAuthGuard)
export class PositionsController {
  constructor(
    private readonly accounts: AccountService,
    private readonly positions: PositionsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: FirebaseUserPayload): Promise<Position[]> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.positions.list(accountId);
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') positionId: string,
  ): Promise<Position> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.positions.getOne(accountId, positionId);
  }
}
