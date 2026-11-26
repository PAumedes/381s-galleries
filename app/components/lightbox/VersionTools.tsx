import { useRef, useState } from "react";

import type { TFunction } from "../../i18n/t";
import type { GalleryPhoto } from "../types";
import { comparePair } from "./compare-math";
import { BTN } from "./styles";
import { VersionCompare } from "./VersionCompare";
import { VersionHistory } from "./VersionHistory";

type Props = { t: TFunction; photo: GalleryPhoto; chrome: string };

/**
 * Everything versioned in the lightbox (T6.53c history, T6.53e compare). One
 * instance per photo (keyed by the caller), so navigating closes the compare.
 */
export function VersionTools({ t, photo, chrome }: Props) {
  const [comparing, setComparing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pair = comparePair(photo);
  const close = () => {
    setComparing(false);
    button.current?.focus();
  };
  return (
    <>
      {pair && comparing && (
        <VersionCompare t={t} photo={photo} pair={pair} onClose={close} />
      )}
      <VersionHistory
        t={t}
        photo={photo}
        chrome={chrome}
        comparing={comparing}
        action={
          pair && (
            <button
              ref={button}
              type="button"
              data-testid="compare-open"
              className={`${BTN} w-auto min-w-11 px-2 text-micro uppercase underline`}
              aria-expanded={comparing}
              onClick={() => (comparing ? close() : setComparing(true))}
            >
              {comparing
                ? t("compare.close")
                : t("compare.open", { n: pair.previous.n })}
            </button>
          )
        }
      />
    </>
  );
}
