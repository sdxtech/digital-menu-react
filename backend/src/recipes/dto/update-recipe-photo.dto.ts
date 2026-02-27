import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class UpdateRecipePhotoDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    protocols: ['http', 'https'],
  })
  imageUrl: string;
}
