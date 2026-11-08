const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}

export function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFileEntry {
  name: string;
  data: Uint8Array | string;
}

export function buildZip(files: ZipFileEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries: {
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    offset: number;
  }[] = [];

  let totalSize = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes =
      typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(dataBytes);
    entries.push({ nameBytes, dataBytes, crc, offset: 0 });
    totalSize += 30 + nameBytes.length + dataBytes.length;
  }

  let cdSize = 0;
  for (const entry of entries) {
    cdSize += 46 + entry.nameBytes.length;
  }
  totalSize += cdSize + 22;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // 1. Local File Headers + Data
  for (const entry of entries) {
    entry.offset = offset;
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(offset + 8, 0, true); // STORE
    view.setUint16(offset + 10, 0, true); // Mod time
    view.setUint16(offset + 12, 0x5821, true); // Mod date (2024-01-01)
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.dataBytes.length, true);
    view.setUint32(offset + 22, entry.dataBytes.length, true);
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += 30;

    buffer.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;

    buffer.set(entry.dataBytes, offset);
    offset += entry.dataBytes.length;
  }

  // 2. Central Directory
  const cdOffset = offset;
  for (const entry of entries) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true); // UTF-8
    view.setUint16(offset + 10, 0, true); // STORE
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0x5821, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.dataBytes.length, true);
    view.setUint32(offset + 24, entry.dataBytes.length, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, entry.offset, true);
    offset += 46;

    buffer.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
  }

  // 3. End of Central Directory Record
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, cdSize, true);
  view.setUint32(offset + 16, cdOffset, true);
  view.setUint16(offset + 20, 0, true);

  return buffer;
}

/** Reads the STORE archives produced by this editor and validates their integrity. */
export function readZip(buffer: Uint8Array): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new Error(`无效的 ZIP 文件：${message}`);
  };
  const range = (offset: number, length: number, limit = buffer.length) => {
    check(offset >= 0 && length >= 0 && offset + length <= limit, "文件内容被截断或超出范围");
  };
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === buffer.length) {
      end = i;
      break;
    }
  }
  check(end >= 0, "找不到完整目录");
  check(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, "不支持分卷");
  const count = view.getUint16(end + 10, true);
  check(count === view.getUint16(end + 8, true), "目录文件数不一致");
  let offset = view.getUint32(end + 16, true);
  const directoryStart = offset, directorySize = view.getUint32(end + 12, true);
  check(offset + directorySize === end, "目录范围不一致");
  for (let i = 0; i < count; i++) {
    range(offset, 46, end);
    check(view.getUint32(offset, true) === 0x02014b50, "目录签名错误");
    const flags = view.getUint16(offset + 8, true);
    check((flags & ~0x0800) === 0, "不支持加密或数据描述符");
    check(view.getUint16(offset + 10, true) === 0, "仅支持本工作台导出的 STORE (0) ZIP");
    const checksum = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    check(size === view.getUint32(offset + 20, true), "文件大小不一致");
    const nameSize = view.getUint16(offset + 28, true);
    const entrySize = 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    range(offset, entrySize, end);
    const name = decoder.decode(buffer.subarray(offset + 46, offset + 46 + nameSize));
    check(!!name && !name.startsWith("/") && !name.includes("\\") && !name.split("/").includes("..") && !name.includes("\0"), "文件名无效");
    check(!result.has(name), `重复文件 ${name}`);
    const local = view.getUint32(offset + 42, true);
    range(local, 30, directoryStart);
    check(view.getUint32(local, true) === 0x04034b50, "本地文件头错误");
    check(view.getUint16(local + 6, true) === flags && view.getUint16(local + 8, true) === 0, "文件头格式不一致");
    check(view.getUint32(local + 14, true) === checksum && view.getUint32(local + 18, true) === size && view.getUint32(local + 22, true) === size, "文件头校验不一致");
    const localNameSize = view.getUint16(local + 26, true);
    const dataStart = local + 30 + localNameSize + view.getUint16(local + 28, true);
    range(local + 30, dataStart - local - 30, directoryStart);
    check(decoder.decode(buffer.subarray(local + 30, local + 30 + localNameSize)) === name, "文件名不一致");
    range(dataStart, size, directoryStart);
    const data = buffer.slice(dataStart, dataStart + size);
    check(crc32(data) === checksum, `文件校验失败 ${name}`);
    result.set(name, data);
    offset += entrySize;
  }
  check(offset === end, "目录长度不一致");
  return result;
}
