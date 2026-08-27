import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { entities } from './entities';
import ormConfig from './orm.config';

@Module({
  imports: [MikroOrmModule.forRoot(ormConfig), MikroOrmModule.forFeature(entities)],
  exports: [MikroOrmModule],
})
export class PersistenceModule {}
