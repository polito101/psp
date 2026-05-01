import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** Límite compartido con `MerchantOnboardingService.listApplications` (defensa en profundidad). */
export const MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MIN_LENGTH = 2;
export const MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MAX_LENGTH = 100;

const statuses = ['ACCOUNT_CREATED', 'DOCUMENTATION_PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ACTIVE'] as const;

export class ListMerchantOnboardingApplicationsQueryDto {
  @ApiPropertyOptional({ enum: statuses })
  @IsOptional()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @ApiPropertyOptional({ example: 'ada@example.com', maxLength: MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MAX_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MIN_LENGTH)
  @MaxLength(MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
