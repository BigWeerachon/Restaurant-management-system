/** The reverse of `encodeCp874`, for reading a printer's stream back. */
export const Cp874 = {
  decode(bytes: number[]): string {
    let s = "";
    for (const b of bytes) {
      if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
      else if (b >= 0xa1 && b <= 0xda) s += String.fromCharCode(0x0e01 + (b - 0xa1));
      else if (b === 0xdf) s += "฿";
      else if (b >= 0xe0 && b <= 0xfb) s += String.fromCharCode(0x0e40 + (b - 0xe0));
      else if (b === 0xa0) s += " ";
      else if (b === 0x80) s += "€";
      else s += "?";
    }
    return s;
  },
};
