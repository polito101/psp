import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectMerchantOnboardingDto {
  @ApiProperty({ example: 'No cumple los requisitos de riesgo actuales.' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}
