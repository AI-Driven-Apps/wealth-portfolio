import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { bhavUrl, indexUrl, parseBhav, unzipFirst } from "@/lib/providers/nse";

/** Minimal single-file zip, the way NSE builds them (deflate, sizes in the central directory). */
function zip(name: string, text: string): Uint8Array {
  const data = deflateRawSync(Buffer.from(text)), n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const cdAt = 30 + n.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(cdAt, 16);
  return new Uint8Array(Buffer.concat([local, n, data, cd, n, end]));
}

describe("NSE bhavcopy", () => {
  it("builds the right URL either side of the July 2024 format change", () => {
    expect(bhavUrl("2023-02-14")).toBe("https://nsearchives.nseindia.com/content/historical/EQUITIES/2023/FEB/cm14FEB2023bhav.csv.zip");
    expect(bhavUrl("2024-07-05")).toMatch(/historical\/EQUITIES\/2024\/JUL\/cm05JUL2024bhav/);
    expect(bhavUrl("2024-07-08")).toBe("https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20240708_F_0000.csv.zip");
    expect(indexUrl("2026-10-16")).toBe("https://nsearchives.nseindia.com/content/indices/ind_close_all_16102026.csv");
  });
  it("reads the current (UDiFF) layout out of the zip", () => {
    const csv = [
      "TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric",
      "2026-10-16,2026-10-16,CM,NSE,STK,4986,INE962Y01021,IRCON,EQ,,,,,IRCON INTERNATIONAL LTD,106.33,108.16,105.31,106.62,107.00",
      "2026-10-16,2026-10-16,CM,NSE,STK,3742,IN0020210053,SGBMAY29I,GB,,,,,2.5%GOLDBONDS2029SR-I,14680.56,14890.00,14620.00,14698.79,14700.00",
    ].join("\r\n");
    expect(parseBhav(unzipFirst(zip("BhavCopy.csv", csv)))).toEqual([
      { symbol: "IRCON", isin: "INE962Y01021", series: "EQ", close: 106.62 },
      { symbol: "SGBMAY29I", isin: "IN0020210053", series: "GB", close: 14698.79 },
    ]);
  });
  it("reads the legacy layout", () => {
    const csv = "SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN,\nTCS,EQ,3505,3524.85,3495,3500.1,3500,3482.4,1579818,5548005902.75,14-FEB-2023,103413,INE467B01029,\n";
    expect(parseBhav(unzipFirst(zip("cm14FEB2023bhav.csv", csv)))).toEqual([{ symbol: "TCS", isin: "INE467B01029", series: "EQ", close: 3500.1 }]);
  });
  it("rejects something that isn't a zip or a bhavcopy", () => {
    expect(() => unzipFirst(new TextEncoder().encode("<html>Too Many Requests</html>"))).toThrow(/not a zip/);
    expect(() => parseBhav("a,b\n1,2")).toThrow(/layout/);
  });
});
