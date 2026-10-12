import { Module } from '@nestjs/common';
import { PseudonymizationModule } from './pseudonymization/pseudonymization.module.js';

@Module({
  imports: [PseudonymizationModule],
})
export class AppModule {}
