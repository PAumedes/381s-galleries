/** One plain sentence about where the owner stands (read by screen readers as a status). */
export function StatusNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="border-ink text-ink border-s-4 ps-3 text-base font-medium"
    >
      {children}
    </p>
  );
}
