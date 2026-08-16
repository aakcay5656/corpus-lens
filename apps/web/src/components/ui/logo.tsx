/**
 * The wordmark, matching the tab icon in `app/icon.svg`.
 *
 * The two are kept separate deliberately rather than sharing one file: the favicon has to
 * be a standalone `.svg` at a path Next recognises, and it is drawn for 16 pixels — solid
 * background, thick strokes. This one renders at 20 and sits next to text, so it drops the
 * filled tile and takes its colour from `currentColor`, which means it inherits the theme
 * instead of carrying a hard-coded blue into dark mode.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      // Decorative: the adjacent text already names the app, and announcing it twice is
      // noise for a screen reader.
      aria-hidden="true"
    >
      <circle cx="14" cy="14" r="6.25" stroke="currentColor" strokeWidth="2.75" />
      <path
        d="M18.9 18.9 L23.6 23.6"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
