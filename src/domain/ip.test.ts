import { describe, expect, it } from "vitest";
import { ipPrefix } from "./ip.ts";

describe("ipPrefix", () => {
  it.each([
    ["93.41.10.7", "93.41.10.7"],
    ["::ffff:93.41.10.7", "93.41.10.7"],
    ["2a01:4f8:1c1c:abcd:1:2:3:4", "2a01:04f8:1c1c:abcd::/64"],
    ["2a01:4f8::1", "2a01:04f8:0000:0000::/64"],
    ["2A01:4F8:1C1C:ABCD::", "2a01:04f8:1c1c:abcd::/64"],
  ])("%s → %s", (ip, prefix) => {
    expect(ipPrefix(ip)).toBe(prefix);
  });

  it("due dispositivi nella stessa /64 IPv6 hanno lo stesso prefisso", () => {
    expect(ipPrefix("2a01:4f8:1c1c:abcd::1")).toBe(ipPrefix("2a01:4f8:1c1c:abcd:ffff::9"));
  });

  it.each(["", "999.1.1.1", "1.2.3", "2a01::4f8::1", "ciao", "1:2:3:4:5:6:7:8:9"])(
    "rifiuta %s",
    (ip) => {
      expect(ipPrefix(ip)).toBeNull();
    },
  );
});
