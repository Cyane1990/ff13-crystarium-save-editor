// FF13 enemy data (db/resident/bt_chara_spec.wdb) editing + in-place archive patching.
// inflate/deflate are injected (browser: DecompressionStream/CompressionStream 'deflate' = zlib format).
const HM = (() => {
  const SECTOR = 0x800, PATH = 'db/resident/bt_chara_spec.wdb';
  const td = new TextDecoder('latin1'), te = new TextEncoder();
  const le32 = (b, o) => (b[o] | b[o+1] << 8 | b[o+2] << 16 | b[o+3] << 24) >>> 0;
  const wle32 = (b, o, v) => { b[o] = v & 255; b[o+1] = v >>> 8 & 255; b[o+2] = v >>> 16 & 255; b[o+3] = v >>> 24 & 255; };
  const be32 = (b, o) => ((b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3]) >>> 0;
  const wbe32 = (b, o, v) => { b[o] = v >>> 24 & 255; b[o+1] = v >>> 16 & 255; b[o+2] = v >>> 8 & 255; b[o+3] = v & 255; };
  const be16 = (b, o) => (b[o] << 8) | b[o+1];
  const wbe16 = (b, o, v) => { b[o] = v >>> 8 & 255; b[o+1] = v & 255; };

  // ---- filelist{u,c}.win32.bin: header (chunkInfoOff, chunkDataOff, fileCount) LE, 8-byte entries
  // (code u32, chunk u16, offsetInChunk u16), chunk table of (uncmp, cmp, off) LE, zlib chunks of
  // "sector:uncmp:cmp:path\0" strings (hex).
  async function parseFilelist(fl, inflate, path = PATH) {
    const ci = le32(fl, 0), cd = le32(fl, 4), n = le32(fl, 8);
    if (ci !== 12 + n * 8 || ci >= fl.length || cd > fl.length) throw new Error('This does not look like an FF13 filelist (filelistu/filelistc.win32.bin).');
    const chunks = [];
    for (let i = 0; i < (cd - ci) / 12; i++) {
      const u = le32(fl, ci + i * 12), c = le32(fl, ci + i * 12 + 4), o = le32(fl, ci + i * 12 + 8);
      const data = await inflate(fl.subarray(cd + o, cd + o + c));
      if (data.length !== u) throw new Error('Filelist chunk size mismatch.');
      chunks.push({ u, c, o, data });
    }
    let hit = null;
    chunks.forEach((ch, ci2) => {
      let p = 0;
      while (p < ch.data.length) {
        let z = ch.data.indexOf(0, p); if (z < 0) z = ch.data.length;
        const s = td.decode(ch.data.subarray(p, z));
        const m = /^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+):(.*)$/.exec(s);
        if (m && m[4] === path && !hit) hit = { chunk: ci2, at: p, len: z - p, sector: parseInt(m[1], 16), uncmp: parseInt(m[2], 16), cmp: parseInt(m[3], 16), str: s };
        p = z + 1;
      }
    });
    if (!hit) throw new Error('This filelist has no ' + path + '.');
    // the next file after ours in the archive bounds how much space we may use
    let next = Infinity;
    chunks.forEach(ch => td.decode(ch.data).split('\0').forEach(s => {
      const m = /^([0-9a-f]+):[0-9a-f]+:[0-9a-f]+:/.exec(s); if (m) { const sec = parseInt(m[1], 16); if (sec > hit.sector && sec < next) next = sec; }
    }));
    hit.room = next === Infinity ? Math.ceil(hit.cmp / SECTOR) * SECTOR : (next - hit.sector) * SECTOR;
    return { ci, cd, n, chunks, hit };
  }
  // Rebuild the filelist with our entry's compressed size changed (string length must stay the same).
  async function patchFilelist(fl, parsed, newCmp, deflate) {
    const { ci, cd, chunks, hit } = parsed;
    const oldCmpHex = hit.str.split(':')[2], newCmpHex = newCmp.toString(16);
    if (newCmpHex.length !== oldCmpHex.length) throw new Error('New size changes the filelist entry length; not supported.');
    const parts = hit.str.split(':'); parts[2] = newCmpHex; const ns = parts.join(':');
    const chunks2 = chunks.map((ch, i) => {
      if (i !== hit.chunk) return ch;
      const d = new Uint8Array(ch.data); d.set(te.encode(ns), hit.at); return { ...ch, data: d, dirty: true };
    });
    const comp = [];
    for (const ch of chunks2) comp.push(ch.dirty ? await deflate(ch.data) : fl.subarray(cd + ch.o, cd + ch.o + ch.c));
    const total = cd + comp.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    out.set(fl.subarray(0, cd), 0);
    let off = 0;
    comp.forEach((c, i) => { wle32(out, ci + i * 12, chunks2[i].u); wle32(out, ci + i * 12 + 4, c.length); wle32(out, ci + i * 12 + 8, off); out.set(c, cd + off); off += c.length; });
    return out;
  }

  // ---- WDB (big-endian): header count @4, 0x20-byte table (name[16], off, size). Enemy records 0x168 bytes.
  const F = { hp: 0x10, cp: 0xEC, lv: 0xFE, mag: 0x10C, str: 0x10E };
  function parseWdb(w) {
    if (td.decode(w.subarray(0, 3)) !== 'WPD') throw new Error('Not a WDB file.');
    const n = be32(w, 4), recs = [];
    for (let i = 0; i < n; i++) {
      const o = 0x10 + i * 0x20, id = td.decode(w.subarray(o, o + 16)).split('\0')[0], off = be32(w, o + 16), size = be32(w, o + 20);
      if (id.startsWith('!!') || size < 0x110) continue;
      recs.push({ id, off, hp: be32(w, off + F.hp) & 0xFFFFFF, str: be16(w, off + F.str), mag: be16(w, off + F.mag), cp: be32(w, off + F.cp) & 0xFFFFFF, lv: w[off + F.lv] });
    }
    if (!recs.length) throw new Error('No enemy records found; is this bt_chara_spec.wdb?');
    return recs;
  }
  function writeWdb(w, recs, vals) { // vals: Map id -> {hp,str,mag,cp}
    const out = new Uint8Array(w);
    for (const r of recs) {
      const v = vals.get(r.id); if (!v) continue;
      const clamp = (x, max) => Math.max(1, Math.min(max, Math.round(x)));
      const hi = be32(out, r.off + F.hp) & 0xFF000000; wbe32(out, r.off + F.hp, (hi | clamp(v.hp, 0xFFFFFF)) >>> 0);
      wbe16(out, r.off + F.str, Math.max(0, Math.min(65535, Math.round(v.str))));
      wbe16(out, r.off + F.mag, Math.max(0, Math.min(65535, Math.round(v.mag))));
      const hc = be32(out, r.off + F.cp) & 0xFF000000; wbe32(out, r.off + F.cp, (hc | Math.max(0, Math.min(0xFFFFFF, Math.round(v.cp)))) >>> 0);
    }
    return out;
  }
  // ---- item_weapon.wdb (big-endian): 0x68-byte records. Passive = string pointers @0x08 (id) and @0x0C (display
  // name), stat type 1 = low nibble @0x41, stat type 2 = u16 @0x42, per-level increase u16 @0x44, starting value s16 @0x46.
  // Max level: ((b[0x38] & 15) - 2) * 64 + (b[0x39] >> 2).
  function parseEquipWdb(w) {
    if (td.decode(w.subarray(0, 3)) !== 'WPD') throw new Error('Not a WDB file.');
    const n = be32(w, 4), recs = []; let str = null;
    const tbl = [];
    for (let i = 0; i < n; i++) {
      const o = 0x10 + i * 0x20; tbl.push({ id: td.decode(w.subarray(o, o + 16)).split('\0')[0], off: be32(w, o + 16), size: be32(w, o + 20) });
    }
    const st = tbl.find(t => t.id === '!!string'); if (!st) throw new Error('item_weapon.wdb has no string table.');
    const S = w.subarray(st.off, st.off + st.size);
    const s = p => { if (p >= S.length) return ''; let z = S.indexOf(0, p); if (z < 0) z = S.length; return td.decode(S.subarray(p, z)); };
    for (const t of tbl) {
      if (t.id.startsWith('!!') || t.size < 0x48) continue;
      const o = t.off;
      recs.push({ id: t.id, off: o, pas: be32(w, o + 8), disp: be32(w, o + 12), pasId: s(be32(w, o + 8)).trim(), dispId: s(be32(w, o + 12)),
        t1: w[o + 0x41] & 15, t2: be16(w, o + 0x42), inc: be16(w, o + 0x44), ini: (be16(w, o + 0x46) << 16) >> 16,
        ml: ((w[o + 0x38] & 15) - 2) * 64 + (w[o + 0x39] >> 2) });
    }
    if (!recs.some(r => r.id.startsWith('acc_'))) throw new Error('No accessories found; is this item_weapon.wdb?');
    return recs;
  }
  function writeEquipWdb(w, recs, vals) { // vals: Map id -> {pas, disp, t1, t2, inc, ini, ml}
    const out = new Uint8Array(w);
    for (const r of recs) {
      const v = vals.get(r.id); if (!v) continue; const o = r.off;
      if (!(v.ml >= 1 && v.ml <= 100)) throw new Error(r.id + ': max level must be 1-100.');
      wbe32(out, o + 8, v.pas); wbe32(out, o + 12, v.disp);
      out[o + 0x41] = (out[o + 0x41] & 0xF0) | (v.t1 & 15); wbe16(out, o + 0x42, v.t2);
      wbe16(out, o + 0x44, Math.max(0, Math.min(65535, Math.round(v.inc))));
      wbe16(out, o + 0x46, Math.max(-32768, Math.min(32767, Math.round(v.ini))) & 0xFFFF);
      out[o + 0x38] = (out[o + 0x38] & 0xF0) | ((v.ml >> 6) + 2); out[o + 0x39] = ((v.ml & 63) << 2) | (out[o + 0x39] & 3);
    }
    return out;
  }
  async function sha256hex(u8) {
    const h = await crypto.subtle.digest('SHA-256', u8);
    return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const GEAR_PATH = 'db/resident/item_weapon.wdb';
  return { SECTOR, PATH, GEAR_PATH, parseFilelist, patchFilelist, parseWdb, writeWdb, parseEquipWdb, writeEquipWdb, sha256hex };
})();
if (typeof module !== 'undefined') module.exports = HM;
