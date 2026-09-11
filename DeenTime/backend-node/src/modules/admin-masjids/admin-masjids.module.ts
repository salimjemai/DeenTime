import { Module } from '@nestjs/common';
import { AdminMasjidsController } from './admin-masjids.controller.js';

@Module({ controllers: [AdminMasjidsController] })
export class AdminMasjidsModule {}
