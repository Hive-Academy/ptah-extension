import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Length,
  IsArray,
  IsUUID,
  IsIn,
  ArrayMaxSize,
} from 'class-validator';

export class SendCampaignDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name!: string;

  @IsUUID()
  @IsOptional()
  templateId?: string;

  @IsString()
  @IsOptional()
  @Length(1, 200)
  subject?: string;

  @IsString()
  @IsOptional()
  @Length(1, 50000)
  htmlBody?: string;

  @IsString()
  @IsOptional()
  @IsIn([
    'all',
    'proActive',
    'communityActive',
    'trialing',
    'subscriptionPastDue',
  ])
  segment?:
    | 'all'
    | 'proActive'
    | 'communityActive'
    | 'trialing'
    | 'subscriptionPastDue';

  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(5000)
  userIds?: string[];
}
