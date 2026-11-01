import fs from 'node:fs';

// Check the delivered PE file as well as the packager's build-time check.
export function assertWindowsGUI(file) {
  const data = fs.readFileSync(file);
  const fail = () => { throw new Error(`${file}: expected a Windows GUI executable (-H windowsgui)`); };
  if (data.length < 64 || data.toString('ascii', 0, 2) !== 'MZ') fail();
  const pe = data.readUInt32LE(0x3c), optional = pe + 24;
  if (pe < 64 || optional + 70 > data.length || data.toString('ascii', pe, pe + 4) !== 'PE\0\0') fail();
  if (data.readUInt16LE(pe + 20) < 70 || ![0x10b, 0x20b].includes(data.readUInt16LE(optional))) fail();
  if (data.readUInt16LE(optional + 68) !== 2) fail();
}
