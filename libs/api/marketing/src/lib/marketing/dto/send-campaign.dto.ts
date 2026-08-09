import {
  IsString,
  IsNotEmpty,
  Length,
  IsArray,
  IsUUID,
  IsIn,
  ArrayMaxSize,
} from 'class-validator';

import { IsOptionalNotNull } from '@ptah-api/core';

export class SendCampaignDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name!: string;

  @IsUUID()
  @IsOptionalNotNull()
  templateId?: string;

  @IsString()
  @IsOptionalNotNull()
  @Length(1, 200)
  subject?: string;

  @IsString()
  @IsOptionalNotNull()
  @Length(1, 50000)
  htmlBody?: string;

  @IsString()
  @IsOptionalNotNull()
  @IsIn(['all', 'buildersActive', 'communityActive', 'subscriptionPastDue'])
  segment?:
    | 'all'
    | 'buildersActive'
    | 'communityActive'
    | 'subscriptionPastDue';

  @IsArray()
  @IsOptionalNotNull()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(5000)
  userIds?: string[];
}
