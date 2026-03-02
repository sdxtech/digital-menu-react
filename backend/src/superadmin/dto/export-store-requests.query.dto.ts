import { IsOptional, IsString, Matches } from 'class-validator';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class ExportStoreRequestsQueryDto {
  @IsOptional()
  @IsString()
  site?: string;

  @IsOptional()
  @IsString()
  sites?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, {
    message: 'startDate must use YYYY-MM-DD format.',
  })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, {
    message: 'endDate must use YYYY-MM-DD format.',
  })
  endDate?: string;
}
