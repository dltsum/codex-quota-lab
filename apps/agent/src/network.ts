import { networkInterfaces, platform, arch } from "node:os";

import type { NetworkIdentity } from "@quotalab/contracts";

export const platformLabel = (): string => `${platform()}-${arch()}`;

export const getNetworkIdentity = (): NetworkIdentity => {
  const interfaces = networkInterfaces();
  const candidates = Object.entries(interfaces)
    .flatMap(([name, values]) => (values ?? []).map((value) => ({ name, ...value })))
    .filter(
      (value) =>
        !value.internal &&
        value.family === "IPv4" &&
        value.address !== "0.0.0.0" &&
        value.mac !== "00:00:00:00:00:00",
    )
    .sort((a, b) => {
      const virtual = /virtual|vmware|hyper-v|docker|veth|loopback|tailscale/i;
      return Number(virtual.test(a.name)) - Number(virtual.test(b.name));
    });
  const selected = candidates[0];
  return {
    privateIp: selected?.address ?? null,
    macAddress: selected?.mac.toUpperCase() ?? null,
  };
};
