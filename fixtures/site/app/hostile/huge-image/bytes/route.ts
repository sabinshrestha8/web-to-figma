// A valid 12 MB BMP (24-bit, 2000x2000, rows need no padding): over maxAssetBytes (10 MB).
export function GET() {
  const width = 2000;
  const height = 2000;
  const header = Buffer.alloc(54);
  header.write("BM", 0);
  header.writeUInt32LE(54 + width * height * 3, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  return new Response(Buffer.concat([header, Buffer.alloc(width * height * 3)]), {
    headers: { "content-type": "image/bmp" },
  });
}
