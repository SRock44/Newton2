interface NewtonMarkProps {
  size?: number;
  className?: string;
}

/** The app's brand mark — an abstract orbit (a tilted ellipse with a body at its center
 * and a satellite riding its path), reused everywhere "Newton" needs a small icon: the
 * title bar, the sidebar header, the login screen, and the chat empty state. Deliberately
 * not a literal apple or a letter "N" in a box — those read as generic placeholder
 * branding. Pure inline SVG (`currentColor`), so it always matches whatever badge/text
 * color it's dropped into and needs no external asset. */
function NewtonMark({ size = 20, className }: NewtonMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse
        cx="12"
        cy="12"
        rx="9.2"
        ry="4.6"
        transform="rotate(-20 12 12)"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="2.3" fill="currentColor" />
      <circle cx="19.3" cy="7.7" r="1.35" fill="currentColor" />
    </svg>
  );
}

export default NewtonMark;
