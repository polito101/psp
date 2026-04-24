import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class PatchMerchantActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}
