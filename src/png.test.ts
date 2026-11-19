import { describe, expect, it } from "vitest";
import { unzlibSync } from "fflate";
import { encodePng } from "./png";

describe("encodePng", () => {
  it("writes a valid RGBA PNG whose pixel data round-trips", () => {
    const w = 5, h = 3, px = new Uint8Array(w * h * 4).map((_, i) => (i * 37) % 256);
    const png = encodePng(px, w, h);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(png.buffer);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
    expect(dv.getUint32(16)).toBe(w);
    expect(dv.getUint32(20)).toBe(h);
    expect(png[25]).toBe(6); // RGBA
    // IHDR CRC of a known header (5x3 RGBA, 8 bit)
    const idatLen = dv.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe("IDAT");
    const raw = unzlibSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
      expect(raw[y * (w * 4 + 1)]).toBe(0);
      expect([...raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1))]).toEqual([...px.subarray(y * w * 4, (y + 1) * w * 4)]);
    }
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
  });

  it("CRCs match zlib's crc32 for the IEND chunk", () => {
    const png = encodePng(new Uint8Array(4), 1, 1);
    const dv = new DataView(png.buffer, png.byteOffset);
    expect(dv.getUint32(png.length - 4)).toBe(0xae426082); // well-known IEND CRC
  });
});
