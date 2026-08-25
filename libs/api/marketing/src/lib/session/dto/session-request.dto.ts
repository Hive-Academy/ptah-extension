import { IsString, MaxLength } from 'class-validator';

import { IsOptionalNotNull } from '@ptah-api/core';

export class SessionRequestDto {
  @IsString()
  sessionTopicId!: string;

  @IsOptionalNotNull()
  @IsString()
  @MaxLength(2000)
  additionalNotes?: string;

  @IsOptionalNotNull()
  @IsString()
  paddleTransactionId?: string;
}
