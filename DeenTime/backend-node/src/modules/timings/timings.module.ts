import { Module } from '@nestjs/common';
import { TimingsController } from './timings.controller.js';

@Module({ controllers: [TimingsController] })
export class TimingsModule {}
