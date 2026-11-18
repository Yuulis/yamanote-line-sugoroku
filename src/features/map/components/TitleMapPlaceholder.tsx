import React from "react";

export function TitleMapPlaceholder(): React.JSX.Element {
  return (
    <div className="title-map-placeholder" aria-hidden="true">
      <svg
        className="title-map-placeholder__loop"
        viewBox="0 0 400 400"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          className="title-map-placeholder__track"
          d="M 196 30 C 253 28 315 64 342 119 C 372 180 361 246 324 296 C 287 346 225 370 163 357 C 99 344 49 294 39 231 C 29 170 55 105 104 67 C 130 47 164 34 196 30 Z"
        />
        <g className="title-map-placeholder__stations">
          <circle cx="196" cy="30" r="7" />
          <circle cx="264" cy="47" r="7" />
          <circle cx="320" cy="83" r="7" />
          <circle cx="349" cy="145" r="7" />
          <circle cx="360" cy="208" r="7" />
          <circle cx="338" cy="269" r="7" />
          <circle cx="297" cy="321" r="7" />
          <circle cx="235" cy="360" r="7" />
          <circle cx="170" cy="357" r="7" />
          <circle cx="108" cy="328" r="7" />
          <circle cx="58" cy="274" r="7" />
          <circle cx="39" cy="211" r="7" />
          <circle cx="49" cy="148" r="7" />
          <circle cx="79" cy="94" r="7" />
          <circle cx="132" cy="52" r="7" />
        </g>
      </svg>
    </div>
  );
}
