/** next/navigation stand-in: router.push is recorded on window.__pushed. */
export const useRouter = () => ({
  push: (url: string) => {
    (window as unknown as { __pushed?: string }).__pushed = url;
  },
  replace: (url: string) => {
    (window as unknown as { __pushed?: string }).__pushed = url;
  },
});
export const useSearchParams = () => new URLSearchParams(window.location.search);
export const usePathname = () => window.location.pathname;
