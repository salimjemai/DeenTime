import { Module } from '@nestjs/common';
import { IqamaController } from './iqama.controller.js';

@Module({ controllers: [IqamaController] })
export class IqamaModule {}
