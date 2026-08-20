import { IsString, IsEnum, MinLength, MaxLength } from 'class-validator';

import { IsOptionalNotNull } from '@ptah-api/core';

export enum ContactCategory {
  GENERAL = 'general',
  BILLING = 'billing',
  TECHNICAL = 'technical',
  FEATURE_REQUEST = 'feature-request',
  OTHER = 'other',
}

export class ContactMessageDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message!: string;

  @IsOptionalNotNull()
  @IsEnum(ContactCategory)
  category?: ContactCategory;
}
