import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller.js';

@Module({ controllers: [LocationsController] })
export class LocationsModule {}
