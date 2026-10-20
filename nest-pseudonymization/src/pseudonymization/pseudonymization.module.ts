import { Module } from '@nestjs/common';
import { PseudonymizationService } from './pseudonymization.service.js';
import { PseudonymizationController } from './pseudonymization.controller.js';
import { AdminController } from './admin.controller.js';
import { UsageService } from './usage.service.js';
import { ActivityService } from './activity.service.js';

@Module({
  imports: [],
  controllers: [PseudonymizationController, AdminController],
  providers: [PseudonymizationService, UsageService, ActivityService],
  exports: [PseudonymizationService],
})
export class PseudonymizationModule {}
