/** @clerk/nextjs stand-in: signOut is recorded on window.__signedOut. */
export const useClerk = () => ({
  signOut: async (opts: unknown) => {
    (window as unknown as { __signedOut?: unknown }).__signedOut = opts;
  },
});
