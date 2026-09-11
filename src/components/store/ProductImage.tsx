import Image from "next/image";
import { LogoMark } from "./Logo";

export function ProductImage({
  src,
  alt,
  sizes = "(min-width: 1024px) 25vw, 50vw",
  priority = false,
}: {
  src: string | null;
  alt: string;
  sizes?: string;
  priority?: boolean;
}) {
  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-panel-2" role="img" aria-label={alt}>
        <LogoMark className="h-12 w-12 opacity-40" />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized={src.endsWith(".svg")}
      className="object-cover"
    />
  );
}
