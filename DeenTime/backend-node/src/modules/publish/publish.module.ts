import { Module } from '@nestjs/common';
import { PdfGeneratorService } from './pdf-generator.service.js';
import { PublishController } from './publish.controller.js';

/** PublishController and its PDF generator (IPdfGenerator → QuestPdfGenerator in Program.cs). */
@Module({ controllers: [PublishController], providers: [PdfGeneratorService] })
export class PublishModule {}
