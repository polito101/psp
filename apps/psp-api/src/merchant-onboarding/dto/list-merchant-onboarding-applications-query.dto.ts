import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const statuses = ['ACCOUNT_CREATED', 'DOCUMENTATION_PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ACTIVE'] as const;

export class ListMerchantOnboardingApplicationsQueryDto {
  @ApiPropertyOptional({ enum: statuses })
  @IsOptional()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @ApiPropertyOptional({ example: 'ada@example.com' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
