'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ImagePlus, Loader2, Star, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { productImageUrl } from '@/lib/supabase/images';
import { attachProductImage, removeProductImage, setPrimaryImage } from '@/lib/actions/products';
import { cn } from '@/lib/utils';

interface ProductImageRow {
  id: string;
  storage_path: string;
  alt_text: string;
  sort_order: number;
  is_primary: boolean;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Photos go straight from the browser to Supabase Storage under the staff
 * member's own session — a 5 MB file never passes through a server action. The
 * server is only told the resulting path.
 *
 * The bucket policy already restricts writes to managers, so a demoted account
 * cannot upload even with this component on screen.
 */
export function ProductImageManager({
  productId,
  productName,
  images,
}: {
  productId: string;
  productName: string;
  images: ProductImageRow[];
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const sorted = [...images].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.sort_order - b.sort_order;
  });

  async function upload(files: FileList | File[]) {
    setError(null);
    const list = Array.from(files);
    if (list.length === 0) return;

    const rejected = list.find((file) => !ACCEPTED.includes(file.type) || file.size > MAX_BYTES);
    if (rejected) {
      setError(
        !ACCEPTED.includes(rejected.type)
          ? `${rejected.name} is not a JPEG, PNG, WebP, or AVIF.`
          : `${rejected.name} is over 5 MB. Resize it and try again.`,
      );
      return;
    }

    setUploading(true);
    const supabase = createClient();

    try {
      for (const file of list) {
        const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const path = `${productId}/${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(path, file, { cacheControl: '31536000', upsert: false });

        if (uploadError) {
          setError(
            uploadError.message.includes('policy')
              ? 'Your role cannot upload photos. Ask an administrator for manager access.'
              : `Upload failed: ${uploadError.message}`,
          );
          break;
        }

        const result = await attachProductImage({
          productId,
          storagePath: path,
          altText: productName,
        });

        if (!result.ok) {
          // The file landed but the row did not. Clean up rather than leaving
          // an orphan nobody can see or delete.
          await supabase.storage.from('product-images').remove([path]);
          setError(result.message);
          break;
        }
      }
      router.refresh();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
        className={cn(
          'rounded-xl border border-dashed px-4 py-6 text-center transition-colors',
          dragging ? 'border-primary bg-accent' : 'border-border',
        )}
      >
        <ImagePlus className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm font-medium">Drop photos here</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          JPEG, PNG, WebP, or AVIF up to 5 MB. Square images look best in the shop grid.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          multiple
          className="sr-only"
          onChange={(event) => event.target.files && void upload(event.target.files)}
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {uploading ? 'Uploading' : 'Choose files'}
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}

      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          With no photo, the shop grid shows a generated tile with the product&rsquo;s initials — it
          never looks broken, but a real photo sells better.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {sorted.map((image) => {
            const url = productImageUrl(image.storage_path);
            const busy = busyId === image.id;

            return (
              <li
                key={image.id}
                className="group relative overflow-hidden rounded-lg border border-border bg-muted"
              >
                <div className="relative aspect-square">
                  {url ? (
                    <Image
                      src={url}
                      alt={image.alt_text || productName}
                      fill
                      sizes="200px"
                      className="object-cover"
                    />
                  ) : null}
                  {busy ? (
                    <div className="absolute inset-0 grid place-items-center bg-black/40">
                      <Loader2 className="size-5 animate-spin text-white" aria-hidden />
                    </div>
                  ) : null}
                </div>

                {image.is_primary ? (
                  <Badge tone="green" className="absolute left-1.5 top-1.5">
                    Main image
                  </Badge>
                ) : null}

                <div className="flex items-center justify-between gap-1 p-1.5">
                  {image.is_primary ? (
                    <span className="px-1 text-xs text-muted-foreground">Shown in the grid</span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setBusyId(image.id);
                        void setPrimaryImage(productId, image.id)
                          .then((r) => !r.ok && setError(r.message))
                          .finally(() => {
                            setBusyId(null);
                            router.refresh();
                          });
                      }}
                    >
                      <Star className="size-3.5" aria-hidden />
                      Make main
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove this photo of ${productName}`}
                    disabled={busy}
                    onClick={() => {
                      setBusyId(image.id);
                      void removeProductImage(image.id)
                        .then((r) => !r.ok && setError(r.message))
                        .finally(() => {
                          setBusyId(null);
                          router.refresh();
                        });
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
