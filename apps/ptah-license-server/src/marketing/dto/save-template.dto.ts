import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Length,
  IsArray,
} from 'class-validator';

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
  @IsOptional()
  @IsString({ each: true })
  variables?: string[];
}
