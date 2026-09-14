import { Module } from '@nestjs/common';
import { DesignController } from './design.controller.js';

@Module({ controllers: [DesignController] })
export class DesignModule {}
