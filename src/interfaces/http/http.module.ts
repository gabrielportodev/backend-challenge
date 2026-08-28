import { ApplicationModule } from '@application/application.module';
import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';
import { WageringController } from './controllers/wagering.controller';
import { WalletController } from './controllers/wallet.controller';

@Module({
  imports: [ApplicationModule],
  controllers: [HealthController, WalletController, WageringController],
})
export class HttpModule {}
