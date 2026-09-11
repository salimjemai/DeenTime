import { Module } from '@nestjs/common';
import { ApiClientCredentialService } from './api-client-credential.service.js';
import { ApiClientsController } from './api-clients.controller.js';

/** Organization API client keys: /api/v1/orgs/{organizationId}/api-clients. */
@Module({
  controllers: [ApiClientsController],
  providers: [ApiClientCredentialService],
  exports: [ApiClientCredentialService],
})
export class ApiClientsModule {}
