import { IsString, IsNotEmpty, Length, IsArray } from 'class-validator';

import { IsOptionalNotNull } from '@ptah-api/core';

export class SaveTemplateDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 50000)
  htmlBody!: string;

  @IsArray()
  @IsOptionalNotNull()
  @IsString({ each: true })
  variables?: string[];
}
