import type { AnchorHTMLAttributes, ReactNode } from "react";

/** next/link stand-in: a plain anchor (tests read href, nothing navigates). */
export default function Link({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
