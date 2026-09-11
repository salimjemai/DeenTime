import { Module } from '@nestjs/common';
import { LegacyRedirectController } from './legacy-redirect.controller.js';
import { PublicController } from './public.controller.js';

/** Public display API and the legacy embed redirects (PublicController.cs). */
@Module({ controllers: [PublicController, LegacyRedirectController] })
export class PublicModule {}
