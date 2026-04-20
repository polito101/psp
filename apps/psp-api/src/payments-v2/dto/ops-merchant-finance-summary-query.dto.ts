import { IsDateString, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from '../domain/payment-provider-names';

export class OpsMerchantFinanceSummaryQueryDto {
  @IsOptional()
  @IsIn([...PAYMENT_PROVIDER_NAMES])
  provider?: PaymentProviderName;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;
}
