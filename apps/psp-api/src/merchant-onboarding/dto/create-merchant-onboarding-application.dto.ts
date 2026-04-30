import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMerchantOnboardingApplicationDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: '+34600000000' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  phone!: string;
}
