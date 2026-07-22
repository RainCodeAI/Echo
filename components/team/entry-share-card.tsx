"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { Check, Copy, Download, ExternalLink, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type EntryShareCardProps = {
  companyName: string;
  entryUrl: string | null;
  entryPath: string | null;
  isLoading?: boolean;
};

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "echo"
  );
}

export function EntryShareCard({
  companyName,
  entryUrl,
  entryPath,
  isLoading,
}: EntryShareCardProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!entryUrl) {
      setQrCodeDataUrl(null);
      return;
    }

    let active = true;
    void QRCode.toDataURL(entryUrl, {
      width: 360,
      margin: 2,
      color: {
        dark: "#064e3b",
        light: "#ecfdf5",
      },
    }).then((dataUrl) => {
      if (active) setQrCodeDataUrl(dataUrl);
    });

    return () => {
      active = false;
    };
  }, [entryUrl]);

  async function handleCopyLink() {
    if (!entryUrl) return;
    try {
      await navigator.clipboard.writeText(entryUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function handleDownloadQr() {
    if (!qrCodeDataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = qrCodeDataUrl;
    anchor.download = `${slugify(companyName)}-echo-entry-qr.png`;
    anchor.click();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="h-4 w-4 text-primary" />
          Field entry link
        </CardTitle>
        <CardDescription>
          Share this URL or print the QR code. Crew members enter their 4-digit
          PIN — no app install or Clerk account required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !entryUrl || !entryPath ? (
          <p className="text-sm text-muted-foreground">
            Workspace not ready yet. Refresh after signing in.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Entry URL
              </p>
              <div className="break-all rounded-lg border bg-muted/40 px-3 py-3 font-mono text-xs sm:text-sm">
                {entryUrl}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handleCopyLink}>
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> Copy link
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleDownloadQr}
                  disabled={!qrCodeDataUrl}
                >
                  <Download className="h-4 w-4" />
                  Download QR
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={entryPath} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Open entry
                  </Link>
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex shrink-0 items-center justify-center rounded-xl border bg-emerald-50 p-4">
                {qrCodeDataUrl ? (
                  <Image
                    src={qrCodeDataUrl}
                    alt={`QR code for ${companyName} field entry`}
                    width={160}
                    height={160}
                    unoptimized
                    className="rounded-lg bg-white p-2"
                  />
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center text-sm text-muted-foreground">
                    Generating…
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                <p className="font-medium text-foreground">Posting tip</p>
                <p className="mt-2 text-muted-foreground">
                  Print the QR and stick it near the truck, trailer, or job board.
                  Workers scan it, enter their PIN, and record a voice note.
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
