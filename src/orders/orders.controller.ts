import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CurrentUser } from '../auth/firebase-auth.decorator';
import { FirebaseUserPayload } from '../auth/firebase.service';
import { AccountService } from '../portfolio/account.service';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from '../common/dto/create-order.dto';
import { ListOrdersQueryDto } from '../common/dto/query-dtos';
import { Order } from '../common/interfaces';

@Controller('api/orders')
@UseGuards(FirebaseAuthGuard)
export class OrdersController {
  constructor(
    private readonly accounts: AccountService,
    private readonly orders: OrdersService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @CurrentUser() user: FirebaseUserPayload,
    @Body() dto: CreateOrderDto,
  ): Promise<Order> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.orders.createOrder(accountId, dto, 'manual');
  }

  @Get()
  async list(
    @CurrentUser() user: FirebaseUserPayload,
    @Query() query: ListOrdersQueryDto,
  ): Promise<Order[]> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.orders.list(accountId, query);
  }

  @Delete(':id')
  async cancel(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') orderId: string,
  ): Promise<Order> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.orders.cancel(accountId, orderId);
  }
}
