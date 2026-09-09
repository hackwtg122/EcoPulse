from pathlib import Path
import fitz

source = Path("attached_assets/Plantilla_Manual_de_Usuario_Desarrollo_Sostenible_1788965287439.pdf")
output_dir = Path(".agents/outputs/manual_pages")
output_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(source)
print(f"pages={document.page_count}")
for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    output = output_dir / f"page-{index + 1:02d}.png"
    pixmap.save(output)
    text = page.get_text("text").replace("\n", " ")
    print(f"page={index + 1} size={page.rect.width:.0f}x{page.rect.height:.0f} text_chars={len(text)} images={len(page.get_images(full=True))}")