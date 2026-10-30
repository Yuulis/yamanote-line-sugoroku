import type { ReactNode } from "react";
import type { ItemKind } from "../../../types/network";

export interface ItemIconProps {
  kind: ItemKind;
  size?: number;
}

type IconDrawing = () => ReactNode;

const ITEM_ICON_DRAWINGS: Readonly<Record<ItemKind, IconDrawing>> = {
  "route-ticket": () => <>
    <path d="M9 11h10v26H9z" />
    <path d="M13 17h3M13 23h3M13 29h3M24 17h8v6h7M28 23v8h8" />
    <circle cx="24" cy="17" r="2" className="item-icon__accent" />
    <circle cx="36" cy="31" r="2" className="item-icon__accent" />
  </>,
  "direction-ticket": () => <>
    <path d="M9 11h30v26H9zM15 24h18" />
    <path d="m27 17 7 7-7 7" className="item-icon__accent-stroke" />
    <path d="M14 16h5M14 32h5" />
  </>,
  "roll-adjust": () => <>
    <path d="M12 7h24a5 5 0 0 1 5 5v24a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5V12a5 5 0 0 1 5-5z" />
    <path d="M24 14v10m-5-5h10M19 33h10" className="item-icon__accent-stroke" />
    <circle cx="15" cy="15" r="1" /><circle cx="33" cy="33" r="1" />
  </>,
  double: () => <>
    <path d="M22 5 9 26h9l-3 17 15-23h-9l4-15z" className="item-icon__accent" />
    <path d="M22 5 9 26h9l-3 17 15-23h-9l4-15z" />
    <path d="m28 31 6 6m0-6-6 6M36 30a3 3 0 1 1 5.2 2L36 38h6" />
  </>,
  rapid: () => <>
    <path d="M8 9h7l9 15-9 15H8l9-15zM24 9h7l9 15-9 15h-7l9-15z" className="item-icon__accent-stroke" />
    <path d="M7 24h34" />
  </>,
  deadhead: () => <>
    <path d="M8 36V19a16 16 0 0 1 32 0v17z" />
    <path d="M15 19a9 9 0 0 1 18 0v7H15z" className="item-icon__accent" />
    <path d="M12 31h24M12 36v4M36 36v4" />
    <rect x="17" y="28" width="14" height="5" rx="1" />
  </>,
  "delay-certificate": () => <>
    <path d="M24 5 40 11v12c0 10-7 16-16 20C15 39 8 33 8 23V11z" />
    <path d="m24 13 2.5 6 6.5.5-5 4.2 1.6 6.3-5.6-3.5-5.6 3.5 1.6-6.3-5-4.2 6.5-.5z" className="item-icon__accent" />
  </>,
  delay: () => <>
    <circle cx="24" cy="24" r="17" />
    <path d="M24 13v12l8 5" className="item-icon__accent-stroke" />
    <path d="M17 5h14M17 43h14" />
  </>,
  suspension: () => <>
    <path d="M9 10h30v28H9zM15 17h18v14H15z" />
    <path d="m17 18 14 12m0-12L17 30" className="item-icon__accent-stroke" />
    <path d="M5 24h4M39 24h4" />
  </>,
  detour: () => <>
    <path d="m8 36 8-12 8 10 8-14 8 10" />
    <circle cx="8" cy="36" r="2.5" className="item-icon__accent" />
    <circle cx="40" cy="30" r="2.5" className="item-icon__accent" />
  </>,
  oversleep: () => <>
    <path d="M8 30h32M11 30V18h13v12M25 24h9a6 6 0 0 1 6 6M9 35h30" />
    <path d="M26 14h4l-4 5h4M32 9h5l-5 6h5M39 3h6l-6 7h6" className="item-icon__accent-stroke" />
  </>,
};

export function ItemIcon({ kind, size = 24 }: ItemIconProps): React.JSX.Element {
  const drawing: IconDrawing = ITEM_ICON_DRAWINGS[kind];
  return (
    <svg
      className="item-icon"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {drawing()}
    </svg>
  );
}
