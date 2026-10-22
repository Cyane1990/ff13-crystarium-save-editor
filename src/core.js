// FF13 PC save crypto + layout (body starts at 0x208; key table recovered by known-plaintext)
const FF13 = (() => {
  const HDR = 0x208, CONST = 0xA1652347;
  // 32 key blocks: K0 * 5^j mod 2^64
  const KEYS = (() => {
    const out = []; let k = 0xc9fb220123d7e0efn; const M = (1n << 64n) - 1n;
    for (let j = 0; j < 32; j++) {
      const b = new Uint8Array(8); let t = k;
      for (let i = 0; i < 8; i++) { b[i] = Number(t & 0xffn); t >>= 8n; }
      out.push(b); k = (k * 5n) & M;
    }
    return out;
  })();
  const u32 = (b, o) => (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0;
  const w32 = (b, o, v) => { b[o]=v&255; b[o+1]=(v>>>8)&255; b[o+2]=(v>>>16)&255; b[o+3]=(v>>>24)&255; };
  function gears(bc, blk) {
    // (bc << 20) as 64-bit: lo / hi words
    const lo = (bc * 0x100000) % 0x100000000, hi = Math.floor(bc / 0x1000);
    let g1 = (lo | ((bc << 10) >>> 0) | bc) >>> 0;
    const cf = g1 > ((~CONST) >>> 0) ? 1 : 0;
    g1 = (g1 + CONST) >>> 0;
    const g2 = ((((blk * 2) >>> 0) | hi) + cf) >>> 0;
    return [g1, g2];
  }
  function ksum(K) { let s = 8 * 0x78; for (const x of K) s -= x; return s & 255; }
  function decrypt(src) {
    const n = src.length, out = new Uint8Array(n), b = new Uint8Array(8);
    for (let blk = 0; blk < n / 8; blk++) {
      const bc = blk * 8, K = KEYS[blk & 31], ks = ksum(K);
      for (let p = 0; p < 8; p++) {
        const c = src[bc + p];
        const x = p === 0 ? (0x45 ^ (blk & 255) ^ c) : (c ^ src[bc + p - 1]);
        b[p] = (x + ks) & 255;
      }
      let TA = u32(b, 0), TB = u32(b, 4); const KA = u32(K, 0), KB = u32(K, 4);
      const [g1, g2] = gears(bc, blk);
      const cf = TA < KA ? 1 : 0;
      const nA = (KA ^ g1 ^ ((TA - KA) >>> 0)) >>> 0;
      const nB = (KB ^ g2 ^ ((TB - KB - cf) >>> 0)) >>> 0;
      w32(out, bc, nB); w32(out, bc + 4, nA);
    }
    return out;
  }
  function encrypt(src) {
    const n = src.length, out = new Uint8Array(n), b = new Uint8Array(8);
    for (let blk = 0; blk < n / 8; blk++) {
      const bc = blk * 8, K = KEYS[blk & 31], ks = (256 - ksum(K)) & 255;
      const [g1, g2] = gears(bc, blk);
      const KA = u32(K, 0), KB = u32(K, 4);
      let TB = (KB ^ g2 ^ u32(src, bc)) >>> 0, TA = (KA ^ g1 ^ u32(src, bc + 4)) >>> 0;
      const cf = TA > ((~KA) >>> 0) ? 1 : 0;
      TB = (TB + KB + cf) >>> 0; TA = (TA + KA) >>> 0;
      w32(b, 0, TA); w32(b, 4, TB);
      let prev = 0;
      for (let p = 0; p < 8; p++) {
        const y = (b[p] + ks) & 255;
        const c = p === 0 ? (0x45 ^ (blk & 255) ^ y) : (y ^ prev);
        out[bc + p] = c; prev = c;
      }
    }
    return out;
  }
  function checksum(d) { let s = 0; const n = d.length - 8; for (let i = 0; i + 4 <= n; i += 4) s = (s + d[i]) >>> 0; return s; }
  function open(fileBytes) {
    if (fileBytes.length < HDR + 0x30000 || (fileBytes.length - HDR) % 8) throw new Error('This does not look like an FF13 PC save (ff13-XX.dat).');
    const header = fileBytes.slice(0, HDR), body = decrypt(fileBytes.subarray(HDR));
    if (checksum(body) !== u32(body, body.length - 4)) throw new Error('Decryption check failed — this file is not a valid FF13 PC save, or it is damaged.');
    const td = new TextDecoder('latin1');
    if (td.decode(body.subarray(0, 16)) !== 'Sound::SnapshotP') throw new Error('Unexpected save layout.');
    const title = td.decode(header.subarray(8, 0x100)).split('\0')[0];
    return { header, body, title };
  }
  function build(save) {
    const body = new Uint8Array(save.body);
    w32(body, body.length - 4, checksum(body));
    const out = new Uint8Array(HDR + body.length);
    out.set(save.header, 0); out.set(encrypt(body), HDR);
    return out;
  }
  // Character records ("db_ptmem"): 0xD80 bytes each from 0x1C100. Learned-ability list: count byte @+0x27, 16-byte ID slots from +0x28.
  const REC0 = 0x1C100, RECSZ = 0xD80, LIST = 0x28, SLOT = 16, CAP = 128;
  const CHARS = [
    { key: 'lightning', name: 'Lightning', idx: 13, letter: 'l', pre: 'c000' },
    { key: 'snow', name: 'Snow', idx: 16, letter: 's', pre: 'c001' },
    { key: 'sazz', name: 'Sazh', idx: 14, letter: 'z', pre: 'c002' },
    { key: 'hope', name: 'Hope', idx: 11, letter: 'h', pre: 'c003' },
    { key: 'vanira', name: 'Vanille', idx: 17, letter: 'v', pre: 'c004' },
    { key: 'fang', name: 'Fang', idx: 9, letter: 'f', pre: 'c005' },
  ];
  function recBase(c) { return REC0 + c.idx * RECSZ; }
  function readAbilities(save, c) {
    const b = save.body, o = recBase(c), td = new TextDecoder('latin1');
    const nm = td.decode(b.subarray(o + 5, o + 21)).split('\0')[0];
    if (nm !== c.key) throw new Error(`Character record for ${c.name} not where expected (found "${nm}").`);
    // Read every filled slot: earlier hand edits left entries past the count byte.
    const list = [];
    for (let i = 0; i < CAP; i++) {
      const s = b.subarray(o + LIST + i * SLOT, o + LIST + (i + 1) * SLOT);
      const z = s.indexOf(0); const id = td.decode(z < 0 ? s : s.subarray(0, z));
      if (id) list.push(id);
    }
    return list;
  }
  function writeAbilities(save, c, ids) {
    if (ids.length > CAP) throw new Error(`${c.name}: at most ${CAP} abilities.`);
    const b = save.body, o = recBase(c);
    b.fill(0, o + LIST, o + LIST + CAP * SLOT);
    ids.forEach((id, i) => {
      if (!/^[\x21-\x7e]{1,15}$/.test(id)) throw new Error(`Bad ability ID "${id}"`);
      for (let k = 0; k < id.length; k++) b[o + LIST + i * SLOT + k] = id.charCodeAt(k);
    });
    b[o + LIST - 2] = 0; b[o + LIST - 1] = ids.length;
  }
  // ---- ATB: one byte per character at +0xC58, segments × 10
  const ATB = 0xC58;
  function readAtb(save, c) { return save.body[recBase(c) + ATB] / 10; }
  function writeAtb(save, c, seg) {
    if (!(seg >= 1 && seg <= 6 && Number.isInteger(seg))) throw new Error(`${c.name}: ATB must be 1–6 segments.`);
    save.body[recBase(c) + ATB] = seg * 10;
  }

  // ---- Roles: six big-endian u32 role levels at +0xC28 (0 = locked, 1-5 = role level)
  // in the order Sentinel, Commando, Ravager, Synergist, Saboteur, Medic.
  const ROLE_AT = 0xC28, ROLE_ORDER = ['SEN', 'COM', 'RAV', 'SYN', 'SAB', 'MED'];
  function readRoles(save, c) {
    const b = save.body, o = recBase(c) + ROLE_AT, out = {};
    ROLE_ORDER.forEach((r, i) => { out[r] = be32(b, o + i * 4); });
    return out;
  }
  function writeRoles(save, c, levels) {
    const b = save.body, o = recBase(c) + ROLE_AT;
    ROLE_ORDER.forEach((r, i) => {
      const v = levels[r];
      if (!(Number.isInteger(v) && v >= 0 && v <= 5)) throw new Error(`${c.name}: role levels must be 0-5.`);
      wbe32(b, o + i * 4, v);
    });
  }

  // ---- Inventory bags: 20-byte entries = ID (16 bytes, NUL-padded) + big-endian u32 count
  const BAGS = {
    items:   { start: 0x37298, n: 60 },
    weapons: { start: 0x3774C, n: 240 },
    accs:    { start: 0x38A10, n: 360 },
    mats:    { start: 0x3A634, n: 240 },
  };
  const ENT = 20, MAXQ = 99;
  const td = new TextDecoder('latin1');
  const str = (b, o, n) => { const s = b.subarray(o, o + n); const z = s.indexOf(0); return td.decode(z < 0 ? s : s.subarray(0, z)); };
  const be32 = (b, o) => ((b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3]) >>> 0;
  const wbe32 = (b, o, v) => { b[o] = v >>> 24 & 255; b[o+1] = v >>> 16 & 255; b[o+2] = v >>> 8 & 255; b[o+3] = v & 255; };
  function readBag(save, key) {
    const { start, n } = BAGS[key], b = save.body, out = [];
    for (let i = 0; i < n; i++) { const o = start + i * ENT, id = str(b, o, 16); if (id) out.push({ id, count: be32(b, o + 16) }); }
    return out;
  }
  function writeBag(save, key, list) {
    const { start, n } = BAGS[key], b = save.body;
    if (list.length > n) throw new Error(`Too many entries for this bag (max ${n}).`);
    b.fill(0, start, start + n * ENT);
    list.forEach((e, i) => {
      if (!/^[\x21-\x7e]{1,15}$/.test(e.id)) throw new Error(`Bad item ID "${e.id}"`);
      const o = start + i * ENT;
      for (let k = 0; k < e.id.length; k++) b[o + k] = e.id.charCodeAt(k);
      wbe32(b, o + 16, e.count);
    });
  }

  // ---- Equipment table: 512 × 28 bytes = ID (16) + flags. +16 = equipped (0/1), +17 = level.
  // Weapon/accessory bags hold references "0000000_<index in hex, 7 digits>".
  const EQ = 0x45408, EQN = 512, EQSZ = 28;
  const refOf = idx => '0000000_' + idx.toString(16).padStart(7, '0');
  const idxOf = ref => /^0{7}_[0-9a-f]{7}$/.test(ref) ? parseInt(ref.slice(8), 16) : -1;
  function readEquip(save, idx) {
    const o = EQ + idx * EQSZ, b = save.body;
    return { idx, id: str(b, o, 16), equipped: b[o + 16] === 1, level: b[o + 17] };
  }
  // ---- Party: 6 member slots @0x1BE20, 3 battle slots @0x1BE38, leader @0x1BE44 (4 bytes each, record index in byte 1,
  // ff ff ff ff = empty), then member count @0x1BE4C and battle count @0x1BE4D. Battle team = first members.
  const PM = 0x1BE20, PB = 0x1BE38, PL = 0x1BE44, PCNT = 0x1BE4C;
  const byIdx = i => CHARS.find(c => c.idx === i);
  function readParty(save) {
    const b = save.body, rd = o => b[o] === 0xff ? null : (byIdx(b[o + 1]) || { key: '?' + b[o + 1] }).key;
    const members = [], battle = [];
    for (let i = 0; i < 6; i++) { const k = rd(PM + i * 4); if (k) members.push(k); }
    for (let i = 0; i < 3; i++) { const k = rd(PB + i * 4); if (k) battle.push(k); }
    return { members, battle, leader: rd(PL) };
  }
  function writeParty(save, battle, reserve) {
    const all = [...battle, ...reserve];
    if (!battle.length || battle.length > 3) throw new Error('The battle team needs 1–3 characters.');
    if (all.length > 6 || new Set(all).size !== all.length) throw new Error('Each character can only be in the party once.');
    const b = save.body, put = (o, key) => {
      if (!key) { b.fill(0xff, o, o + 4); return; }
      const c = CHARS.find(x => x.key === key); if (!c) throw new Error('Unknown character ' + key);
      b[o] = 0; b[o + 1] = c.idx; b[o + 2] = 0; b[o + 3] = 0;
    };
    for (let i = 0; i < 6; i++) put(PM + i * 4, all[i]);
    for (let i = 0; i < 3; i++) put(PB + i * 4, battle[i]);
    put(PL, battle[0]);
    b[PCNT] = all.length; b[PCNT + 1] = battle.length;
  }
  // Weapons / accessories the party owns: [{idx, id, equipped, level, ref}]
  function readGear(save, bag) {
    return readBag(save, bag).map(e => {
      const i = idxOf(e.id); if (i < 0 || i >= EQN) return { idx: -1, ref: e.id, id: e.id, equipped: true, level: 0 };
      return { ...readEquip(save, i), ref: e.id };
    });
  }
  // Apply a final list for one gear bag. Kept entries (idx >= 0) may change level; idx === -2 entries are new.
  function writeGear(save, bag, list) {
    const b = save.body, before = readGear(save, bag);
    const keep = new Map(list.filter(a => a.idx >= 0).map(a => [a.idx, a]));
    for (const a of before) {
      if (a.idx >= 0 && !keep.has(a.idx)) {
        if (a.equipped) throw new Error(`Can't remove equipped gear (${a.id}). Unequip it in game first.`);
        b.fill(0, EQ + a.idx * EQSZ, EQ + a.idx * EQSZ + 16); // same as the game does when an item is sold
      }
    }
    const used = new Set();
    for (const k of ['weapons', 'accs']) if (k !== bag) readBag(save, k).forEach(e => used.add(idxOf(e.id)));
    keep.forEach((_, i) => used.add(i));
    for (let i = 0; i < 20; i++) used.add(idxOf(str(b, 0x37104 + i * ENT, 16))); // recent-pickups list
    const lvl = v => { v = Math.round(v); if (!(v >= 1 && v <= 100)) throw new Error('Levels must be 1–100.'); return v; };
    const refs = [];
    for (const a of list) {
      if (a.idx === -1) { refs.push({ id: a.ref, count: 1 }); continue; } // unreadable entry, kept as-is
      if (a.idx >= 0) {
        const o = EQ + a.idx * EQSZ;
        if (a.id && a.id !== str(b, o, 16)) { // changed into a different item: rewrite the type ID in place
          if (!/^(acc|wea)_[\x21-\x7e]{1,11}$/.test(a.id)) throw new Error(`Bad item ID "${a.id}"`);
          b.fill(0, o, o + 16); for (let k = 0; k < a.id.length; k++) b[o + k] = a.id.charCodeAt(k);
        }
        if (a.level !== undefined && a.level !== b[o + 17]) b[o + 17] = lvl(a.level);
        refs.push({ id: a.ref, count: 1 }); continue;
      }
      let free = -1;
      for (let i = 0; i < EQN; i++) { if (!used.has(i) && !str(b, EQ + i * EQSZ, 16)) { free = i; break; } }
      if (free < 0) throw new Error('The equipment table is full; remove something first.');
      used.add(free);
      const o = EQ + free * EQSZ;
      b.fill(0, o, o + EQSZ);
      for (let k = 0; k < a.id.length; k++) b[o + k] = a.id.charCodeAt(k);
      b[o + 17] = lvl(a.level || 1); // unequipped
      refs.push({ id: refOf(free), count: 1 });
    }
    writeBag(save, bag, refs);
  }
  const readAccessories = s => readGear(s, 'accs'), writeAccessories = (s, l) => writeGear(s, 'accs', l);
  return { open, build, decrypt, encrypt, checksum, readAbilities, writeAbilities, readAtb, writeAtb,
           readBag, writeBag, readGear, writeGear, readParty, writeParty, readRoles, writeRoles, ROLE_ORDER, readAccessories, writeAccessories, CHARS, CAP, MAXQ, BAGS };
})();
if (typeof module !== 'undefined') module.exports = FF13;
