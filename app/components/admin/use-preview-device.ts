import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import {
  DEVICE_PARAM,
  isDevice,
  rememberDevice,
  resolveDevice,
  type PreviewDevice,
} from "../../lib/preview-device";
import { useIsClient } from "../../lib/use-is-client";

/**
 * The device the admin is looking at: `?device=` (a link from the preview),
 * else what they chose last in this tab (sessionStorage), else the phone /
 * desktop default of the viewport. It is read once, right after hydration and
 * before the first paint (the server and the hydrating render say "desktop"),
 * and then lives in state: saves, revalidations and tab changes never reset it.
 */
export function usePreviewDevice() {
  const [params] = useSearchParams();
  const param = params.get(DEVICE_PARAM);
  const client = useIsClient();
  const [device, setDevice] = useState<PreviewDevice | null>(null);
  if (client && device === null) setDevice(resolveDevice(param));
  useEffect(() => {
    if (isDevice(param)) rememberDevice(param);
  }, [param]);
  const choose = (d: PreviewDevice) => {
    setDevice(d);
    rememberDevice(d);
  };
  return [device ?? "desktop", choose] as const;
}
