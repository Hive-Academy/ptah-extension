import {
  IsString,
  IsOptional,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';

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

  @IsOptional()
  @IsEnum(ContactCategory)
  category?: ContactCategory;
}
