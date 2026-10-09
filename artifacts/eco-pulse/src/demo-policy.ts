export const MAX_DEMO_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateDemoImage(file: Pick<File, "type" | "size">): string | null {
  if (!(["image/jpeg", "image/png"] as string[]).includes(file.type)) {
    return "Elige una imagen JPG o PNG.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_DEMO_IMAGE_BYTES) {
    return "La imagen debe pesar entre 1 byte y 5 MB.";
  }
  return null;
}
