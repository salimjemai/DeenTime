import { Module } from '@nestjs/common';
import { HijriController } from './hijri.controller.js';

@Module({ controllers: [HijriController] })
export class HijriModule {}
