import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CurrentUser } from '../auth/firebase-auth.decorator';
import { FirebaseUserPayload } from '../auth/firebase.service';
import { AccountService } from './account.service';
import { PositionsService } from './positions.service';
import { Position } from '../common/interfaces';
import { PatchPositionDto } from '../common/dto/patch-position.dto';

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

  @Patch(':id')
  async patchRisk(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') positionId: string,
    @Body() dto: PatchPositionDto,
  ): Promise<Position> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.positions.patchRisk(accountId, positionId, dto.stopLoss ?? null, dto.takeProfit ?? null);
  }
}
