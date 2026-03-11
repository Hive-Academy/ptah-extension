import { IsString, IsOptional, MaxLength } from 'class-validator';

export class SessionRequestDto {
  @IsString()
  sessionTopicId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalNotes?: string;

  @IsOptional()
  @IsString()
  paddleTransactionId?: string;
}
