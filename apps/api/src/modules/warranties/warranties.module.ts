import { Module } from '@nestjs/common'
import { WarrantiesController } from './warranties.controller.js'
import { WarrantiesService } from './warranties.service.js'

@Module({
  controllers: [WarrantiesController],
  providers: [WarrantiesService],
  exports: [WarrantiesService],
})
export class WarrantiesModule {}
