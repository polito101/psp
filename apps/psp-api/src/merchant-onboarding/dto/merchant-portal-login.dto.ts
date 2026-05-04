import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class MerchantPortalLoginDto {
  @ApiProperty({ example: 'merchant@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'correcthorsebatterystaple' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
