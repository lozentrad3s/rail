"use client";

import { DYNAMIC_ENVIRONMENT_ID, DynamicRoot } from "./dynamic-sign-in";
import { ProviderScreen } from "./provider-screen";

/** Dynamic around the provider page when it is configured; the plain page when it is not. */
export function ProviderWithDynamic() {
  return DYNAMIC_ENVIRONMENT_ID ? (
    <DynamicRoot>
      <ProviderScreen />
    </DynamicRoot>
  ) : (
    <ProviderScreen />
  );
}
