import { Module } from '@nestjs/common'
import { TyresController } from './tyres.controller.js'
import { TyresService } from './tyres.service.js'

@Module({
  controllers: [TyresController],
  providers: [TyresService],
  exports: [TyresService],
})
export class TyresModule {}
