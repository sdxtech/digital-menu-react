const RecipeImportTemplateDownload = ({ inline = false }: { inline?: boolean }) => (
  <a
    href={`${import.meta.env.BASE_URL}templates/recipe-import-template.xlsx`}
    download="Recipe Import Template.xlsx"
    className={inline ? 'font-semibold text-primary underline underline-offset-2' : 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-white px-4 text-xs font-semibold text-primary hover:bg-primary-soft'}
  >
    {!inline ? <i className="bi bi-download text-base leading-none" aria-hidden="true" /> : null}
    <span>Download template</span>
  </a>
)

export default RecipeImportTemplateDownload
