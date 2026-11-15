"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export type PosterFormat = "poster" | "sticker";

/**
 * Printable crew entry poster (US Letter) or truck sticker (4×4 in):
 * the QR code for the crew link plus three steps, in English and Spanish.
 */
export function CrewPoster({ companyName, entryUrl, format }: { companyName: string; entryUrl: string; format: PosterFormat }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(entryUrl, { width: 1024, margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }).then(
      (url) => active && setQr(url),
    );
    return () => {
      active = false;
    };
  }, [entryUrl]);

  const steps = [
    ["Scan the code", "Escanea el código"],
    ["Enter your 4-digit PIN", "Ingresa tu PIN de 4 dígitos"],
    ["Tap record and talk", "Toca grabar y habla"],
  ];

  if (format === "sticker") {
    return (
      <div
        data-testid="poster"
        className="mx-auto flex aspect-square w-full max-w-[4in] flex-col items-center justify-center gap-[0.08in] border-2 border-black bg-white p-[0.2in] text-center text-black print:h-[4in] print:w-[4in] print:max-w-none"
      >
        <p className="text-[0.2in] font-bold leading-tight">{companyName}</p>
        <p className="text-[0.13in] leading-tight">Job notes: scan, PIN, talk · Escanea, PIN, habla</p>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={`QR code for ${entryUrl}`} className="h-[2.6in] w-[2.6in]" />
        ) : (
          <div className="h-[2.6in] w-[2.6in] bg-neutral-100" />
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="poster"
      className="mx-auto flex w-full max-w-[8.5in] flex-col items-center gap-6 border bg-white p-6 text-center text-black sm:p-10 print:h-[11in] print:w-[8.5in] print:max-w-none print:border-0 print:p-[0.6in]"
    >
      <div>
        <p className="text-2xl font-bold sm:text-4xl print:text-[0.5in]">{companyName}</p>
        <p className="mt-1 text-base sm:text-xl print:text-[0.25in]">Job-site voice notes · Notas de voz del trabajo</p>
      </div>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt={`QR code for ${entryUrl}`} className="aspect-square w-full max-w-[4.5in] print:w-[4.5in]" />
      ) : (
        <div className="aspect-square w-full max-w-[4.5in] bg-neutral-100" />
      )}
      <ol className="w-full max-w-[6.5in] space-y-3 text-left">
        {steps.map(([en, es], i) => (
          <li key={en} className="flex items-center gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-lg font-bold text-white print:h-[0.55in] print:w-[0.55in] print:text-[0.3in]">
              {i + 1}
            </span>
            <span>
              <span className="block text-lg font-semibold sm:text-2xl print:text-[0.32in]">{en}</span>
              <span className="block text-base text-neutral-600 sm:text-lg print:text-[0.24in]">{es}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="break-all text-xs text-neutral-500 print:text-[0.14in]">{entryUrl}</p>
    </div>
  );
}
